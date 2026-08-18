<?php

namespace Modules\Drivers\Services;

use RuntimeException;

/**
 * A driver already has a request of this kind waiting (ADR-0032 §4).
 *
 * A 409, not a 422: nothing about the request they sent is invalid — it is
 * the current state that refuses it, and the driver's own screen already
 * shows the one that is open.
 */
class SettlementRequestAlreadyOpenException extends RuntimeException {}
