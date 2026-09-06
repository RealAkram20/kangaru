<?php

namespace Modules\Drivers\Console;

use Illuminate\Console\Command;
use Modules\Drivers\Enums\DriverApplicationStatus;
use Modules\Drivers\Models\DriverApplication;
use Modules\Drivers\Services\DriverDocumentService;

/**
 * Destroys the documents of applications nobody ever decided (ADR-0048 §5).
 *
 * ## The case neither earlier ADR had to think about
 *
 * ADR-0048 §5 disposes of two of the three endings: approval carries the files
 * onto the new driver, rejection destroys them. **The third is an application
 * that is simply never decided**, and until this command that meant a
 * photograph of a stranger's face and national ID sitting on the operator's
 * disk forever, against somebody the platform never employed and never
 * refused.
 *
 * That is the worst of the three outcomes to leave unhandled. A rejected
 * applicant at least had a decision made about them; an abandoned one is a
 * person the office forgot, and their identity documents should not outlive
 * the office's interest in them.
 *
 * ## The row stays. Only the files go.
 *
 * `driver_applications` keeps the name, phone, email and `terms_accepted_at`
 * — that row **is** the record that somebody applied, and destroying it would
 * also destroy the consent timestamp Uganda's Data Protection and Privacy Act,
 * 2019 wants kept. The photographs are not the record; they were evidence for
 * a decision nobody made.
 *
 * The claim ticket is cleared with them. It has been dead for 89 days by then
 * (24-hour window), so this is tidiness rather than a guard — but a spent
 * secret that stays in a column is a spent secret somebody will one day find
 * in a backup and wonder about.
 *
 * ## Ninety days, and why a number at all
 *
 * Long enough that a real applicant chasing the office by telephone is not
 * quietly deleted mid-conversation; short enough that the disk does not become
 * an archive of people who were never hired. It is deliberately **not**
 * configurable: a retention period is a data-protection commitment, and one an
 * operator can quietly lengthen from a settings screen is not a commitment.
 *
 * Idempotent by construction. An application whose documents are already gone
 * contributes nothing on the next run, so re-running after a failure is the
 * right response to one.
 */
class PruneAbandonedApplicationDocuments extends Command
{
    /**
     * @see ADR-0048 §5.
     */
    public const RETENTION_DAYS = 90;

    protected $signature = 'drivers:prune-abandoned-application-documents
                            {--dry-run : List what would be destroyed without destroying it.}';

    protected $description = 'Destroys the uploads of driver applications nobody decided within 90 days (ADR-0048).';

    public function handle(DriverDocumentService $documents): int
    {
        $cutoff = now()->subDays(self::RETENTION_DAYS);

        /**
         * Still `pending` **and** old enough.
         *
         * The status clause is what keeps this away from decided
         * applications: an approved one's documents belong to a driver now
         * (`driver_application_id` is null, so they are unreachable from
         * here anyway), and a rejected one's were destroyed at the decision.
         * Both belts are worth having, because the cost of a bug here is
         * deleting a working driver's licence.
         *
         * `has('documents')` so the log counts applications that actually had
         * something, rather than reporting a hundred rows swept when ninety-
         * eight of them held no files at all.
         */
        $abandoned = DriverApplication::query()
            ->where('status', DriverApplicationStatus::PENDING->value)
            ->where('created_at', '<', $cutoff)
            ->has('documents')
            ->get();

        if ($abandoned->isEmpty()) {
            $this->info('No abandoned applications are holding documents.');

            return self::SUCCESS;
        }

        $dryRun = (bool) $this->option('dry-run');
        $files = 0;

        foreach ($abandoned as $application) {
            if ($dryRun) {
                $held = $application->documents()->count();
                $files += $held;
                $this->line(sprintf(
                    '  would destroy %d document(s) for application %d, submitted %s',
                    $held,
                    $application->getKey(),
                    $application->created_at?->toDateString() ?? 'unknown',
                ));

                continue;
            }

            $files += $documents->discardFor($application);

            // Cleared alongside, per the class notes.
            $application->forceFill([
                'upload_token_hash' => null,
                'upload_token_expires_at' => null,
            ])->save();
        }

        $this->info(sprintf(
            '%s %d document(s) across %d application(s) older than %d days.',
            $dryRun ? 'Would destroy' : 'Destroyed',
            $files,
            $abandoned->count(),
            self::RETENTION_DAYS,
        ));

        return self::SUCCESS;
    }
}
