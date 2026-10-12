package com.printalfa.backend.dto;

import com.printalfa.backend.enums.PaymentMethod;
import com.printalfa.backend.enums.PaymentStatus;
import java.math.BigDecimal;
import java.util.UUID;

public class PaymentResponse {
    private UUID id;
    private UUID orderId;
    private String transactionId;
    private BigDecimal amount;
    private PaymentMethod paymentMethod;
    private PaymentStatus status;

    public PaymentResponse() {}

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }

    public UUID getOrderId() { return orderId; }
    public void setOrderId(UUID orderId) { this.orderId = orderId; }

    public String getTransactionId() { return transactionId; }
    public void setTransactionId(String transactionId) { this.transactionId = transactionId; }

    public BigDecimal getAmount() { return amount; }
    public void setAmount(BigDecimal amount) { this.amount = amount; }

    public PaymentMethod getPaymentMethod() { return paymentMethod; }
    public void setPaymentMethod(PaymentMethod paymentMethod) { this.paymentMethod = paymentMethod; }

    public PaymentStatus getStatus() { return status; }
    public void setStatus(PaymentStatus status) { this.status = status; }
}
