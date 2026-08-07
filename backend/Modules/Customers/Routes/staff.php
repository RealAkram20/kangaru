<?php

use Illuminate\Support\Facades\Route;
use Modules\Customers\Controllers\CustomerRegisterController;

/*
|--------------------------------------------------------------------------
| The customer register — staff side (ADR-0018)
|--------------------------------------------------------------------------
|
| Its own file, and that is load-bearing rather than tidy.
|
| `Modules/Customers/Routes/api.php` is required OUTSIDE the staff
| middleware group in routes/api.php, because customer register and login
| must stay unauthenticated. These routes were first appended to that file
| and inherited exactly one middleware: `api`. No `auth:sanctum`, no
| `tenant`. They still refused everybody — `authorize()` denies a null user,
| which is the fail-closed direction — so nothing leaked, and nothing
| worked either: a valid staff token was ignored and every request 403'd.
|
| A separate file required inside the staff group makes the auth context a
| property of *where the file is included*, not of a group somebody has to
| remember to write. Same idiom as `Modules/Bookings/Routes/public.php`,
| which exists for the mirror-image reason.
|
| Deliberately not under the `/customer` prefix: that marks the customer
| guard's own surface, and these run as staff. The URL should not lie about
| who the caller is.
|
| Nothing here lets staff act *as* a customer — no password reset, no
| impersonation, no editing somebody else's profile. Suspension is the one
| write, and it carries a reason.
|
*/

Route::get('customers', [CustomerRegisterController::class, 'index'])->name('customers.index');
Route::get('customers/{customer}', [CustomerRegisterController::class, 'show'])->name('customers.show');
Route::get('customers/{customer}/activity', [CustomerRegisterController::class, 'activity'])
    ->name('customers.activity.index');
Route::post('customers/{customer}/suspension', [CustomerRegisterController::class, 'suspend'])
    ->name('customers.suspension.store');
Route::delete('customers/{customer}/suspension', [CustomerRegisterController::class, 'restore'])
    ->name('customers.suspension.destroy');
