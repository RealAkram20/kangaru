<?php

namespace Modules\Administration\Console;

use App\Enums\AccessLevel;
use App\Enums\Permission;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;

/**
 * Creates a Kangaru account — head office (ADR-0055 §4, ADR-0056 §6).
 *
 * ## Why this is a command and not an endpoint
 *
 * There was no way to create one at all before this. `UserAdminService`
 * throws for a Kangaru actor creating staff, deliberately, and its comment
 * says so: *"creating head office staff is the serious act ADR-0006 describes,
 * made more so by ADR-0056 — it wants its own path."* This is that path.
 *
 * ADR-0006 already held that onboarding a platform employee *"should be Super
 * Admin's alone"*. ADR-0055 then removed almost all of that account's reach,
 * and ADR-0056 handed it back a single grant — `support.act-as` — that lets it
 * **become anybody on the platform**. An account like that should need a shell
 * on the server, not a web form: no screen to protect, no session to steal, no
 * CSRF story to get right, and a deployment where nobody has SSH is a
 * deployment where nobody can quietly mint one.
 *
 * ## What the role you choose decides
 *
 * The level and the role are separate questions. This command sets the
 * **level**; the role decides what the account may do, and `support.act-as`
 * arrives with the Super Admin role like every other permission does.
 *
 * That was arrived at the hard way. Holding the permission out of the Super
 * Admin catalogue looked like the way to honour ADR-0056 §6's *"not implied by
 * any other"* — and it makes the permission **ungrantable**, because
 * `StoreRoleRequest` refuses to let anybody author a role carrying a permission
 * they do not hold themselves. Ungrantable is not stricter; it is broken.
 *
 * What actually keeps the grant narrow is the **level**: only a `kangaru`
 * account may act as anybody, and creating one needs a shell on this server.
 * A fleet Super Admin holds the permission and cannot use it.
 *
 * So `--role=super_admin` creates an account that can act as anybody from the
 * moment it exists, and the command says so. Give a narrower role, or author
 * one carrying `support.act-as` and little else, if that is more than the
 * person needs.
 */
class CreateKangaruStaff extends Command
{
    protected $signature = 'kangaru:create-staff
        {--name= : The person\'s name}
        {--email= : Their sign-in address}
        {--role=super_admin : Role slug (ADR-0004)}';

    protected $description = 'Create a Kangaru (head office) account. Prompts for a password.';

    public function handle(): int
    {
        $name = $this->option('name') ?: $this->ask('Name');
        $email = $this->option('email') ?: $this->ask('Email');
        // `option()` is typed as everything an option can be, and a `--role`
        // passed twice arrives as an array — which a bare cast would turn into
        // the string "Array" and hand to a `exists:roles,slug` rule that
        // truthfully says no such role. Narrowed rather than cast, so the
        // failure is the message the person needs.
        $role = $this->option('role');
        $role = is_string($role) ? $role : '';

        // Never as an option. A password in `--password` is a password in the
        // shell history, in the process list while it runs, and in whatever
        // ships those to a log aggregator.
        $password = $this->secret('Password');

        $validator = Validator::make(
            ['name' => $name, 'email' => $email, 'password' => $password, 'role' => $role],
            [
                'name' => ['required', 'string', 'max:120'],
                'email' => ['required', 'email', 'max:190', 'unique:users,email'],
                'password' => ['required', Password::defaults()],
                'role' => ['required', 'string', 'exists:roles,slug'],
            ],
        );

        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $error) {
                $this->components->error($error);
            }

            return self::FAILURE;
        }

        $user = new User([
            'name' => $name,
            'email' => $email,
            'password' => Hash::make($password),
            'role' => $role,
            'status' => UserStatus::ACTIVE,
        ]);

        // Declared, never inferred (ADR-0055 §4). Two nulls do not become head
        // office on their own — `User::saving` refuses them — and this is the
        // one place in the application that says the word out loud.
        $user->access_level = AccessLevel::KANGARU;
        $user->save();

        $this->components->info("Kangaru account created: {$user->email} (#{$user->id})");
        $this->components->warn(
            'This account holds no fleet and no client. It reads Kangaru\'s own rows only, and '
            .'reaches a fleet or a client by acting as somebody in it.'
        );

        if ($user->hasPermission(Permission::SUPPORT_ACT_AS)) {
            $this->components->warn(
                'The role you chose carries '.Permission::SUPPORT_ACT_AS->value.', so this account can '
                .'act as any user on the platform from now. Every session is time-boxed, recorded '
                .'against both names, and refused the acts reserved to the person themselves. Give a '
                .'narrower role if that is more than they need.'
            );
        }

        if ($role === UserRole::SUPER_ADMIN->value) {
            $this->components->warn(
                'Super Admin requires a second factor (ADR-0008). Enrol before relying on this account.'
            );
        }

        return self::SUCCESS;
    }
}
