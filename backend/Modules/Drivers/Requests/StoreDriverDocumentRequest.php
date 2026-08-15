<?php

namespace Modules\Drivers\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;
use Modules\Drivers\Enums\DriverDocumentType;

/**
 * A driver uploading one of their papers (ADR-0033).
 *
 * Authorisation is open here and settled in the controller: the driver is the
 * token, so there is no id to authorise against — only a check that the
 * account has a driver profile at all.
 */
class StoreDriverDocumentRequest extends FormRequest
{
    /**
     * Eight megabytes, in kilobytes as Laravel's `max` wants them.
     *
     * Sized from both ends. A modern handset's camera produces 3–6 MB for a
     * document photograph, so a lower ceiling would reject ordinary uploads on
     * a screen with no way to compress; and the uploader is on a Ugandan
     * mobile connection, so a higher one is a driver watching a progress bar
     * on their own data.
     */
    public const MAX_KILOBYTES = 8192;

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
            'type' => ['required', Rule::enum(DriverDocumentType::class)],
            /**
             * `file` plus an explicit mime list, not `image`.
             *
             * `image` would reject a PDF, and an insurance certificate arrives
             * as one about as often as it arrives as a photograph. The list is
             * closed rather than open: this is an upload from an unprivileged
             * client straight onto the operator's disk, and "anything the
             * driver picked" is how a storage bucket becomes a file host.
             */
            'file' => [
                'required',
                'file',
                'mimes:jpg,jpeg,png,webp,pdf',
                'max:'.self::MAX_KILOBYTES,
            ],
            /**
             * A date, and one that has not already passed.
             *
             * `after_or_equal:today` rather than `after:today`: a licence
             * expiring today is valid today, and refusing to record it would
             * send a driver away from the one screen that could have told them
             * to renew it.
             */
            'expires_at' => ['nullable', 'date', 'after_or_equal:today'],
        ];
    }

    /**
     * The expiry is required for the types whose whole meaning is a date.
     *
     * In `withValidator` rather than a `required_if` string, because the
     * condition lives on the enum (`DriverDocumentType::requiresExpiry()`) and
     * a rule string would be a second copy of it — wrong the moment a fifth
     * type is added with a different answer.
     */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $type = DriverDocumentType::tryFrom((string) $this->input('type'));

            if ($type === null || ! $type->requiresExpiry()) {
                return;
            }

            if ($this->input('expires_at') === null || $this->input('expires_at') === '') {
                $validator->errors()->add(
                    'expires_at',
                    sprintf('Tell us when this %s expires.', mb_strtolower($type->label())),
                );
            }
        });
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'file.mimes' => 'Send a photo or a PDF.',
            'file.max' => 'That file is too big. Take the photo again at a smaller size.',
            'expires_at.after_or_equal' => 'That date has already passed.',
        ];
    }
}
