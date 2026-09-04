<?php

namespace Modules\Drivers\Services;

use Modules\Drivers\Models\DriverApplication;

/**
 * Approval was attempted with a document still unaccepted (ADR-0057 §2).
 *
 * **A separate exception from `DriverApplicationClosedException`, and not
 * pedantry.** That one means somebody already decided this application and
 * surfaces as `409 DRIVER_APPLICATION_CLOSED`; the reviewer's move is to
 * refresh the list because their colleague got there first. This one means
 * the application is very much open and there is one more thing to do first.
 * Sharing the class would give the console a status label that reads
 * "closed" over a row it is about to act on, and would leave both cases
 * arriving as the same error code with no way to tell them apart.
 *
 * The message names the documents, because "some document is not accepted" on
 * a list of six is a hunt.
 */
class DriverApplicationDocumentsPendingException extends \RuntimeException
{
    /**
     * @param  list<string>  $documents  type labels, in the order the slots come back
     */
    private function __construct(string $message, public readonly array $documents)
    {
        parent::__construct($message);
    }

    /**
     * @param  list<string>  $documents
     */
    public static function notAccepted(DriverApplication $application, array $documents): self
    {
        return new self(sprintf(
            'Accept or refuse %s before approving %s. A refused document emails them to send another.',
            self::listing($documents),
            $application->name,
        ), $documents);
    }

    /**
     * "the driving licence", or "the driving licence and the vehicle
     * insurance", or "the driving licence, the vehicle insurance and one
     * other".
     *
     * Truncated at two rather than printing six type labels into a sentence
     * nobody finishes reading. The screen lists them all beside their
     * buttons; this is the line at the top of the dialog.
     *
     * @param  list<string>  $documents
     */
    private static function listing(array $documents): string
    {
        $named = array_map(fn (string $label) => 'the '.mb_strtolower($label), array_slice($documents, 0, 2));

        $remaining = count($documents) - count($named);

        if ($remaining > 0) {
            $named[] = $remaining === 1 ? 'one other' : $remaining.' others';
        }

        if (count($named) === 1) {
            return $named[0];
        }

        $last = array_pop($named);

        return implode(', ', $named).' and '.$last;
    }
}
