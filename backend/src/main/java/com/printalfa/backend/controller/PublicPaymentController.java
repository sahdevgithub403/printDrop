package com.printalfa.backend.controller;

import com.printalfa.backend.dto.ApiResponse;
import com.printalfa.backend.dto.PaymentCreateRequest;
import com.printalfa.backend.dto.PaymentResponse;
import com.printalfa.backend.service.PaymentService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/public/payments")
public class PublicPaymentController {

    private final PaymentService paymentService;

    public PublicPaymentController(PaymentService paymentService) {
        this.paymentService = paymentService;
    }

    @PostMapping("/create")
    public ResponseEntity<ApiResponse<PaymentResponse>> createPayment(@Valid @RequestBody PaymentCreateRequest request) {
        // C-07: validates PENDING status + optional shop binding; legitimate customer flow unaffected.
        PaymentResponse response = paymentService.createPayment(request.getOrderId(), request.getPaymentMethod(), request.getShopId());
        return ResponseEntity.ok(ApiResponse.success("Payment initiated", response));
    }

    @PostMapping("/verify")
    public ResponseEntity<ApiResponse<PaymentResponse>> verifyPayment(@RequestBody Map<String, Object> body) {
        String orderIdStr = (String) body.get("orderId");
        String razorpayPaymentId = (String) body.get("razorpayPaymentId");
        String razorpayOrderId = (String) body.get("razorpayOrderId");
        String razorpaySignature = (String) body.get("razorpaySignature");

        if (orderIdStr == null || orderIdStr.trim().isEmpty()) {
            throw new IllegalArgumentException("orderId is required");
        }

        UUID orderId = UUID.fromString(orderIdStr);
        PaymentResponse response = paymentService.verifyPayment(orderId, razorpayPaymentId, razorpayOrderId, razorpaySignature);
        return ResponseEntity.ok(ApiResponse.success("Payment verified successfully", response));
    }

    @PostMapping("/cancel")
    public ResponseEntity<ApiResponse<PaymentResponse>> cancelPayment(@RequestBody Map<String, Object> body) {
        String orderIdStr = (String) body.get("orderId");
        if (orderIdStr == null || orderIdStr.trim().isEmpty()) {
            throw new IllegalArgumentException("orderId is required");
        }
        UUID orderId = UUID.fromString(orderIdStr);
        // C-07: ONLINE cancellations must bind the Razorpay order id (creator context),
        // not a bare orderId. PAY_AT_SHOP cancellations work without it.
        String razorpayOrderId = (String) body.get("razorpayOrderId");
        PaymentResponse response = paymentService.cancelPayment(orderId, razorpayOrderId);
        return ResponseEntity.ok(ApiResponse.success("Payment marked as cancelled", response));
    }

    @PostMapping("/webhook")
    public ResponseEntity<Map<String, String>> handleWebhook(
            @RequestBody String rawPayload,
            @RequestHeader(value = "X-Razorpay-Signature", required = false) String signatureHeader) {
        paymentService.handleWebhook(rawPayload, signatureHeader);
        return ResponseEntity.ok(Map.of("status", "ok"));
    }
}
