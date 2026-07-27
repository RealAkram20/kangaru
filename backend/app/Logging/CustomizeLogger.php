<?php

namespace App\Logging;

use Illuminate\Log\Logger;
use Monolog\Formatter\JsonFormatter;
use Monolog\Handler\FormattableHandlerInterface;

/**
 * Monolog "tap" (config/logging.php stack.tap) that forces structured JSON
 * output on every handler, so request_id/tenant_id/user_id context
 * (attached via Illuminate\Support\Facades\Context in middleware) shows up
 * on every log line in every environment.
 */
class CustomizeLogger
{
    public function __invoke(Logger $logger): void
    {
        foreach ($logger->getHandlers() as $handler) {
            if ($handler instanceof FormattableHandlerInterface) {
                $handler->setFormatter(new JsonFormatter);
            }
        }
    }
}
