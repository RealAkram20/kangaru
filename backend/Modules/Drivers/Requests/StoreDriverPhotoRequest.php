<?php

namespace Modules\Drivers\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * A driver replacing their own photograph (ADR-0041).
 *
 * Authorisation is open here and settled in the controller, exactly as
 * `StoreDriverDocumentRequest` does it: the driver is the token, so there is
 * no id to authorise against — only a check that the account has a driver
 * profile at all.
 */
class StoreDriverPhotoRequest extends FormRequest
{
    /**
     * Four megabytes, in kilobytes as Laravel's `max` wants them.
     *
     * **Half the document ceiling, deliberately.** A licence has to be legible
     * enough for a reviewer to read a number off it; a portrait is rendered at
     * 64 points in a drawer and never read. The uploader is on a Ugandan
     * mobile connection paying for their own data, and there is no reason for
     * this one to cost what a document scan costs.
     */
    public const MAX_KILOBYTES = 4096;

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /*
             * `image` here, unlike the document upload — and the difference is
             * the point. That one accepts a PDF because an insurance
             * certificate arrives as one; a photograph of a person does not,
             * and accepting a PDF would put a file the app cannot render into
             * the one slot whose whole job is being rendered.
             *
             * The mime list stays closed rather than trusting `image` alone:
             * this is an upload from an unprivileged client straight onto the
             * operator's disk, and "anything the driver picked" is how a
             * storage bucket becomes a file host.
             */
            'file' => [
                'required',
                'file',
                'image',
                'mimes:jpg,jpeg,png,webp',
                'max:'.self::MAX_KILOBYTES,
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'file.image' => 'That file is not a photo. Pick a picture of yourself.',
            'file.max' => 'That photo is too large. Pick one under 4 MB.',
        ];
    }
}
