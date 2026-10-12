package com.printalfa.backend.dto;

import com.printalfa.backend.enums.PaymentMethod;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public class PaymentCreateRequest {
    @NotNull(message = "Order ID is required")
    private UUID orderId;

    @NotNull(message = "Payment method is required")
    private PaymentMethod paymentMethod;

    // C-07: optional shop binding — when supplied, the order must belong to this shop.
    private UUID shopId;

    public PaymentCreateRequest() {}

    public UUID getOrderId() { return orderId; }
    public void setOrderId(UUID orderId) { this.orderId = orderId; }

    public PaymentMethod getPaymentMethod() { return paymentMethod; }
    public void setPaymentMethod(PaymentMethod paymentMethod) { this.paymentMethod = paymentMethod; }

    public UUID getShopId() { return shopId; }
    public void setShopId(UUID shopId) { this.shopId = shopId; }
}
