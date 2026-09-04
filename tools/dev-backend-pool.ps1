# Dev backend PHP worker pool.
#
# The backend is served in development by XAMPP Apache on http://localhost:8000
# (vhost in D:\xampp\apache\conf\extra\httpd-vhosts.conf), which load-balances
# across the FastCGI workers this script starts. Run it after every reboot,
# alongside MySQL, the queue worker and the scheduler. Idempotent: ports that
# already have a listener are left alone, so re-running it only fills gaps.
#
# Why not `php artisan serve`: on Windows it is one PHP process handling one
# request at a time, so the console's parallel API calls serialize (~1s of
# queueing per screen). Six workers let them land in parallel.

$php = 'C:\php83\php-cgi.exe'
$ports = 9101..9106

if (-not (Test-Path $php)) {
    Write-Error "php-cgi not found at $php"
    exit 1
}

# Workers serve requests until stopped instead of exiting after php-cgi's
# default of 500, which would silently shrink the pool.
$env:PHP_FCGI_MAX_REQUESTS = '0'

$started = 0
foreach ($port in $ports) {
    $listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($listening) {
        Write-Host "port $port already has a listener - skipped"
        continue
    }
    Start-Process -FilePath $php -ArgumentList '-b', "127.0.0.1:$port" -WindowStyle Hidden
    $started++
}
Write-Host "$started worker(s) started on ports $($ports[0])-$($ports[-1])."
