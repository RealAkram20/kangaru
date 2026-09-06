<?php

use Tests\Support\BillingFixtures;

/**
 * `GET /public/fare-quotes` — the tariff answering the order form.
 *
 * The form showed a literal "from UGX …" beside every class while the tariff
 * sat unasked on the server. Every figure here comes from the same
 * `WalkInFareService::quote()` the driver's estimate uses, mapped through
 * `RideVehicleClass`, so the passenger and the driver are told one number.
 */

// Acacia Mall -> Garden City, roughly 1.7 km straight-line.
const QUOTE_QUERY = 'pickup_latitude=0.3346&pickup_longitude=32.5906&dropoff_latitude=0.3268&dropoff_longitude=32.6011';

it('prices every ride class through the public tariff, as the driver is quoted', function () {
    // sedan and boda priced; suv/van absent, so Standard and XL are honestly null.
    BillingFixtures::publicTariff(['sedan' => [5_000, 2_000], 'boda' => [2_000, 1_000]]);

    $response = $this->getJson('/api/v1/public/fare-quotes?'.QUOTE_QUERY)
        ->assertOk()
        ->assertJsonPath('data.quotes.economy.vehicle_category', 'sedan')
        ->assertJsonPath('data.quotes.economy.is_estimate', true)
        ->assertJsonPath('data.quotes.boda.vehicle_category', 'boda')
        // The assumption on record: an electric boda is priced as a boda
        // until the fleet has the category.
        ->assertJsonPath('data.quotes.electric_boda.vehicle_category', 'boda')
        ->assertJsonPath('data.quotes.standard', null)
        ->assertJsonPath('data.quotes.xl', null);

    // Same distance for every class: one straight line, priced five ways.
    expect($response->json('data.quotes.boda.distance_km'))
        ->toBe($response->json('data.quotes.economy.distance_km'));
    expect($response->json('data.quotes.boda.total_minor'))
        ->toBeLessThan($response->json('data.quotes.economy.total_minor'));
});

it('answers null for every class, and 200, when no public tariff exists', function () {
    // The form falls back to its "from" figure; a 4xx would be a form nobody
    // can order from.
    $this->getJson('/api/v1/public/fare-quotes?'.QUOTE_QUERY)
        ->assertOk()
        ->assertJsonPath('data.quotes.economy', null)
        ->assertJsonPath('data.quotes.boda', null);
});

it('refuses half a route', function () {
    $this->getJson('/api/v1/public/fare-quotes?pickup_latitude=0.33&pickup_longitude=32.59')
        ->assertStatus(422);
});

it('needs no account to ask', function () {
    // Read on the form before anybody has signed up (ADR-0015 §1 requires an
    // account to order, not to look).
    $this->getJson('/api/v1/public/fare-quotes?'.QUOTE_QUERY)->assertOk();
});
