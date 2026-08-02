<?php

namespace App\Support\Database;

/**
 * Turns a user's search box input into a `LIKE` pattern.
 *
 * The reason this exists rather than `'%'.$term.'%'` inline: `%` and `_`
 * are wildcards to `LIKE`, and a search term carries them innocently.
 * Someone looking for a passenger called `O_Brien` gets every name with any
 * character in that position, and `50%` matches everything. Not an
 * injection — the value is still bound — but a wrong answer that looks like
 * a right one, which on a trip search is worse than an error.
 *
 * Escaping is backslash, MySQL and MariaDB's default `LIKE` escape
 * character. The backslash itself has to be escaped first, or escaping the
 * wildcards would corrupt it.
 */
final class SearchTerm
{
    /** Matches anywhere in the column — what a search box means. */
    public static function contains(string $term): string
    {
        return '%'.self::escape($term).'%';
    }

    /**
     * A term typed the way a status is *displayed*, matched against the way
     * it is *stored*.
     *
     * Statuses are snake_case in the database (`trip_completed`) and shown
     * with spaces ("Trip completed"). Somebody reading the screen types what
     * they see, so the spaces are folded back before matching — otherwise
     * the one search term a user is certain about is the one that fails.
     */
    public static function containsStatus(string $term): string
    {
        return self::contains(str_replace(' ', '_', $term));
    }

    private static function escape(string $term): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $term);
    }
}
