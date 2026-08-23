<?php

namespace Modules\Vehicles\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Vehicles\Models\VehicleCategory;
use Modules\Vehicles\Requests\StoreVehicleCategoryRequest;
use Modules\Vehicles\Requests\UpdateVehicleCategoryRequest;
use Modules\Vehicles\Resources\VehicleCategoryResource;
use Modules\Vehicles\Services\VehicleCategoryService;

/**
 * The fleet's category vocabulary (ADR-0050).
 *
 * No pagination. Nine rows today and a fleet that adds one a year; a
 * paginated list here would mean the rate card dialog's category picker has
 * to page through the choices it is offering.
 */
class VehicleCategoryController extends Controller
{
    public function __construct(private readonly VehicleCategoryService $categories) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', VehicleCategory::class);

        /** @var User $user */
        $user = $request->user();

        return ApiResponse::success(
            VehicleCategoryResource::collection($this->categories->list($user))
        );
    }

    public function store(StoreVehicleCategoryRequest $request): JsonResponse
    {
        $this->authorize('create', VehicleCategory::class);

        $category = $this->categories->create($request->categoryData());

        return ApiResponse::success(
            new VehicleCategoryResource($category),
            // Says the true thing rather than the congratulatory one. A
            // category is not usable until a tariff prices it (ADR-0050 §5),
            // and the screen that receives this shows which cards are
            // missing it.
            'Category created. It cannot be priced until a rate card version includes it.',
            201,
        );
    }

    public function update(UpdateVehicleCategoryRequest $request, VehicleCategory $vehicleCategory): JsonResponse
    {
        $this->authorize('update', $vehicleCategory);

        $category = $this->categories->update($vehicleCategory, $request->validated());

        return ApiResponse::success(new VehicleCategoryResource($category), 'Category updated.');
    }

    /**
     * Deletes the row outright, or refuses with a 409 naming what holds it.
     *
     * **A data question, not a permission one**, so it lives here rather
     * than in the policy — the same placement and the same reasoning as
     * `RoleController::destroy`.
     *
     * The refusal exists because `rate_card_rates` and `invoice_lines` store
     * the key as a **string with no foreign key** (ADR-0050 §1), so the
     * database will not stop this. There is no `restrictOnDelete` to lean
     * on; deleting a priced category would leave an immutable rate card rate
     * naming nothing, on a version that can never be corrected because
     * versions are immutable. That is the failure this method is.
     *
     * A category nothing has ever used is deleted without ceremony. It is
     * somebody's typo from five minutes ago, and forcing a permanent retired
     * row for it would fill the office's list with its own mistakes.
     */
    public function destroy(VehicleCategory $vehicleCategory): JsonResponse
    {
        $this->authorize('delete', $vehicleCategory);

        $usage = $this->categories->usage($vehicleCategory);

        if (array_sum($usage) > 0) {
            return ApiResponse::error(
                ErrorCode::VEHICLE_CATEGORY_IN_USE,
                $this->refusal($vehicleCategory, $usage),
                [],
                409,
            );
        }

        $this->categories->delete($vehicleCategory);

        return ApiResponse::success(message: 'Category deleted.', status: 204);
    }

    /**
     * Names every holder, not the first one found.
     *
     * "3 vehicles" alone would send a fleet manager to reassign three
     * vehicles and then meet the identical refusal over an invoice line they
     * were never told about — and that second one they can never clear,
     * which is why the message ends by naming retirement rather than
     * implying the delete becomes possible.
     *
     * @param  array{vehicles: int, rate_card_rates: int, invoice_lines: int}  $usage
     */
    private function refusal(VehicleCategory $category, array $usage): string
    {
        $holders = [];

        if ($usage['vehicles'] > 0) {
            $holders[] = $usage['vehicles'].' vehicle(s)';
        }

        if ($usage['rate_card_rates'] > 0) {
            $holders[] = $usage['rate_card_rates'].' rate card price(s)';
        }

        if ($usage['invoice_lines'] > 0) {
            $holders[] = $usage['invoice_lines'].' invoice line(s)';
        }

        return "\"{$category->name}\" cannot be deleted because ".implode(', ', $holders).
            ' still refer to it, and issued invoices must keep reproducing. '.
            'Retire it instead — retiring stops new vehicles and new rate card '.
            'versions from using it, and changes nothing that already does.';
    }
}
