package com.printalfa.backend.controller;

import com.printalfa.backend.dto.ApiResponse;
import com.printalfa.backend.dto.OrderDTO;
import com.printalfa.backend.dto.UpdatePrintStatusRequest;
import com.printalfa.backend.enums.PaymentStatus;
import com.printalfa.backend.security.UserPrincipal;
import com.printalfa.backend.service.OrderService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/admin/orders")
public class AdminOrderController {

    private final OrderService orderService;

    public AdminOrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    private static boolean isSuperAdmin(UserPrincipal userPrincipal) {
        return userPrincipal != null && userPrincipal.getAuthorities().stream()
                .anyMatch(a -> a.getAuthority().equals("ROLE_SUPER_ADMIN"));
    }

    // M-01: super-admins have no shop binding — bypass the tenant check (read-only).
    private static boolean canAccessShopOrder(UserPrincipal userPrincipal, UUID orderShopId) {
        return isSuperAdmin(userPrincipal)
                || (userPrincipal.getShopId() != null && userPrincipal.getShopId().equals(orderShopId));
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<OrderDTO>>> getShopOrders(
            @AuthenticationPrincipal UserPrincipal userPrincipal,
            @RequestParam(required = false) String status) {
        
        UUID shopId = userPrincipal.getShopId();
        if (shopId == null) {
            // M-01: super-admin without a shop must scope reads explicitly instead of NPE/AccessDenied.
            if (!isSuperAdmin(userPrincipal)) {
                throw new AccessDeniedException("User is not associated with any shop");
            }
            throw new IllegalArgumentException("Super admin must provide shop context to list orders");
        }

        List<OrderDTO> orders = orderService.getShopOrders(shopId, status);
        return ResponseEntity.ok(ApiResponse.success(orders));
    }

    @GetMapping("/{orderId}")
    public ResponseEntity<ApiResponse<OrderDTO>> getOrderById(
            @AuthenticationPrincipal UserPrincipal userPrincipal,
            @PathVariable UUID orderId) {
        
        OrderDTO order = orderService.getOrderById(orderId);
        if (!canAccessShopOrder(userPrincipal, order.getShopId())) {
            throw new AccessDeniedException("Unauthorized access to shop order");
        }
        return ResponseEntity.ok(ApiResponse.success(order));
    }

    @PatchMapping("/{orderId}/status")
    public ResponseEntity<ApiResponse<OrderDTO>> updatePrintStatus(
            @AuthenticationPrincipal UserPrincipal userPrincipal,
            @PathVariable UUID orderId,
            @Valid @RequestBody UpdatePrintStatusRequest request) {
        
        OrderDTO existing = orderService.getOrderById(orderId);
        if (!canAccessShopOrder(userPrincipal, existing.getShopId())) {
            throw new AccessDeniedException("Unauthorized access to shop order");
        }

        OrderDTO updated = orderService.updatePrintStatus(orderId, request.getPrintStatus());
        return ResponseEntity.ok(ApiResponse.success("Order status updated", updated));
    }

    @PatchMapping("/{orderId}/items/{itemId}/status")
    public ResponseEntity<ApiResponse<OrderDTO>> updateItemPrintStatus(
            @AuthenticationPrincipal UserPrincipal userPrincipal,
            @PathVariable UUID orderId,
            @PathVariable UUID itemId,
            @Valid @RequestBody UpdatePrintStatusRequest request) {

        OrderDTO existing = orderService.getOrderById(orderId);
        if (!canAccessShopOrder(userPrincipal, existing.getShopId())) {
            throw new AccessDeniedException("Unauthorized access to shop order");
        }

        OrderDTO updated = orderService.updateItemPrintStatus(orderId, itemId, request.getPrintStatus(), userPrincipal.getShopId());
        return ResponseEntity.ok(ApiResponse.success("Item print status updated", updated));
    }

    /**
     * Document Studio: point an order item at an edited document version.
     * Paid/printing orders are rejected by the service (409) so the paid
     * amount and in-flight print jobs are never silently altered.
     */
    @PatchMapping("/{orderId}/items/{itemId}/document")
    public ResponseEntity<ApiResponse<OrderDTO>> swapItemDocument(
            @AuthenticationPrincipal UserPrincipal userPrincipal,
            @PathVariable UUID orderId,
            @PathVariable UUID itemId,
            @RequestBody Map<String, String> body) {

        OrderDTO existing = orderService.getOrderById(orderId);
        if (!canAccessShopOrder(userPrincipal, existing.getShopId())) {
            throw new AccessDeniedException("Unauthorized access to shop order");
        }

        String documentIdStr = body != null ? body.get("documentId") : null;
        if (documentIdStr == null || documentIdStr.trim().isEmpty()) {
            throw new IllegalArgumentException("documentId is required");
        }
        final UUID documentId;
        try {
            documentId = UUID.fromString(documentIdStr.trim());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid documentId");
        }

        OrderDTO updated = orderService.swapItemDocument(orderId, itemId, documentId, userPrincipal.getShopId());
        return ResponseEntity.ok(ApiResponse.success("Item document updated", updated));
    }

    /**
     * Document Studio: list Original/Edited versions available for an item.
     */
    @GetMapping("/{orderId}/items/{itemId}/versions")
    public ResponseEntity<ApiResponse<List<com.printalfa.backend.dto.DocumentDTO>>> getItemDocumentVersions(
            @AuthenticationPrincipal UserPrincipal userPrincipal,
            @PathVariable UUID orderId,
            @PathVariable UUID itemId) {

        OrderDTO existing = orderService.getOrderById(orderId);
        if (!canAccessShopOrder(userPrincipal, existing.getShopId())) {
            throw new AccessDeniedException("Unauthorized access to shop order");
        }

        List<com.printalfa.backend.dto.DocumentDTO> versions =
                orderService.getItemDocumentVersions(orderId, itemId, userPrincipal.getShopId());
        return ResponseEntity.ok(ApiResponse.success(versions));
    }

    @PatchMapping("/{orderId}/payment-status")
    public ResponseEntity<ApiResponse<OrderDTO>> updatePaymentStatus(
            @AuthenticationPrincipal UserPrincipal userPrincipal,
            @PathVariable UUID orderId,
            @RequestBody Map<String, String> body) {
        
        OrderDTO existing = orderService.getOrderById(orderId);
        if (!canAccessShopOrder(userPrincipal, existing.getShopId())) {
            throw new AccessDeniedException("Unauthorized access to shop order");
        }

        String paymentStatusStr = body != null ? body.get("paymentStatus") : null;
        if (paymentStatusStr == null || paymentStatusStr.trim().isEmpty()) {
            throw new IllegalArgumentException("paymentStatus is required");
        }
        // M-03/M-07: validate the enum value instead of letting valueOf throw raw.
        final PaymentStatus newStatus;
        try {
            newStatus = PaymentStatus.valueOf(paymentStatusStr.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid paymentStatus: " + paymentStatusStr);
        }
        OrderDTO updated = orderService.updatePaymentStatus(orderId, newStatus);
        return ResponseEntity.ok(ApiResponse.success("Payment status updated", updated));
    }

    @DeleteMapping("/{orderId}")
    public ResponseEntity<ApiResponse<Void>> deleteOrder(
            @AuthenticationPrincipal UserPrincipal userPrincipal,
            @PathVariable UUID orderId,
            @RequestParam(required = false, defaultValue = "false") boolean confirm) {
        UUID shopId = userPrincipal.getShopId();
        if (shopId == null) {
            throw new AccessDeniedException("User is not associated with any shop");
        }

        // M-05: confirm=true is required for COMPLETED orders; PAID orders are never
        // deleted while the payment record exists (service enforces with 409).
        orderService.deleteOrder(orderId, shopId, confirm);
        return ResponseEntity.ok(ApiResponse.success("Order deleted successfully", null));
    }
}
