<?php

use App\Providers\AppServiceProvider;
use Illuminate\Support\Facades\URL;

/**
 * Links this platform hands out must carry the scheme it is actually served
 * over, and it cannot work that out from the request.
 *
 * A driver uploaded their portrait and the app kept showing an empty circle.
 * The upload had worked — file on disk, `photo_path` recorded, `GET me/photo`
 * answering 200 with the right bytes. The *link* was wrong:
 * `DriverProfileService` builds `photo_url` with `route()`, `route()` takes
 * its scheme from the current request, and behind Traefik the request looks
 * like plain HTTP. A release Android build refuses cleartext by default, so
 * the image request never left the phone, and an `<Image>` that fails draws
 * nothing — no error, no broken icon, just a blank circle.
 *
 * The request looks insecure because the nginx image resolves `REMOTE_ADDR`
 * to the real visitor before PHP sees it, and Symfony rightly will not read
 * `X-Forwarded-Proto` from a peer that is not a trusted proxy. Widening
 * `trustProxies` to cover visitors would mean trusting a header the visitor
 * writes — the forgery `TrustedProxiesTest` exists to reject.
 *
 * So the scheme is declared from `APP_URL` rather than sniffed, and these
 * tests pin both directions: production says https, local development is left
 * alone.
 */
afterEach(function () {
    // `forceScheme` is global state on the URL generator. Left set, it would
    // leak into every test that ran afterwards and quietly make this suite
    // pass for the wrong reason.
    URL::forceScheme(null);
});

it('generates https links when the platform address is https', function () {
    URL::forceScheme(null);
    config(['app.url' => 'https://api.kangaruride.test']);

    $this->app->register(AppServiceProvider::class, true);

    expect(route('me.photo.show'))->toStartWith('https://');
});

it('leaves local development on http', function () {
    URL::forceScheme(null);
    config(['app.url' => 'http://localhost:8000']);

    $this->app->register(AppServiceProvider::class, true);

    expect(route('me.photo.show'))->toStartWith('http://');
});
