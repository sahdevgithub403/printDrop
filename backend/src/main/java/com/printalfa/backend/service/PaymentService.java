package com.printalfa.backend.service;

import com.printalfa.backend.dto.OrderDTO;
import com.printalfa.backend.dto.PaymentResponse;
import com.printalfa.backend.entity.Payment;
import com.printalfa.backend.entity.PrintJob;
import com.printalfa.backend.entity.PrintOrder;
import com.printalfa.backend.enums.JobStatus;
import com.printalfa.backend.enums.PaymentMethod;
import com.printalfa.backend.enums.PaymentStatus;
import com.printalfa.backend.repository.PaymentRepository;
import com.printalfa.backend.repository.PrintJobRepository;
import com.printalfa.backend.repository.PrintOrderRepository;
import com.razorpay.Utils;
import org.json.JSONObject;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Service
public class PaymentService {

    private final PaymentRepository paymentRepository;
    private final PrintOrderRepository printOrderRepository;
    private final PrintJobRepository printJobRepository;
    private final WebSocketService webSocketService;
    private final OrderService orderService;
    private final Environment environment;

    @Value("${razorpay.key-id:}")
    private String razorpayKeyId;

    @Value("${razorpay.key-secret:}")
    private String razorpayKeySecret;

    @Value("${razorpay.webhook-secret:dummy_webhook_secret}")
    private String razorpayWebhookSecret;

    public PaymentService(PaymentRepository paymentRepository,
                          PrintOrderRepository printOrderRepository,
                          PrintJobRepository printJobRepository,
                          WebSocketService webSocketService,
                          @Lazy OrderService orderService,
                          Environment environment) {
        this.paymentRepository = paymentRepository;
        this.printOrderRepository = printOrderRepository;
        this.printJobRepository = printJobRepository;
        this.webSocketService = webSocketService;
        this.orderService = orderService;
        this.environment = environment;
    }

    /**
     * Fail closed for ONLINE payments when only dummy/missing Razorpay keys are configured.
     * Real ONLINE payment creation/verification requires real keys.
     * The {@code test} profile is the single explicit non-prod allowance (offline HMAC
     * verification with test-only keys; never a fake success).
     */
    private void requireRealRazorpayKeys() {
        if (isTestProfile()) {
            return;
        }
        if (isDummyRazorpay()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Online payments are unavailable: Razorpay is not configured. Please use Pay at Shop.");
        }
    }

    private boolean isTestProfile() {
        return environment != null
                && java.util.Arrays.asList(environment.getActiveProfiles()).contains("test");
    }

    private boolean isDummyRazorpay() {
        return razorpayKeyId == null || razorpayKeyId.isBlank()
                || razorpayKeySecret == null || razorpayKeySecret.isBlank()
                || razorpayKeyId.startsWith("rzp_test_dummy")
                || "dummy_secret".equals(razorpayKeySecret);
    }

    @Transactional
    public PaymentResponse createPayment(UUID orderId, PaymentMethod paymentMethod) {
        return createPayment(orderId, paymentMethod, null);
    }

    @Transactional
    public PaymentResponse createPayment(UUID orderId, PaymentMethod paymentMethod, UUID shopId) {
        PrintOrder order = printOrderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Order not found with ID: " + orderId));

        // C-07: when a shop context is supplied, the order must belong to it.
        if (shopId != null && !order.getShop().getId().equals(shopId)) {
            throw new IllegalArgumentException("Order does not belong to the specified shop");
        }

        // Binding: only PENDING orders can initiate a new payment (prevents re-pay of PAID orders).
        if (order.getPaymentStatus() != PaymentStatus.PENDING) {
            throw new IllegalArgumentException("Payment can only be initiated for orders with PENDING payment status");
        }
        // Fail closed for ONLINE when Razorpay is not really configured.
        if (paymentMethod == PaymentMethod.ONLINE) {
            requireRealRazorpayKeys();
        }

        Payment payment = paymentRepository.findByOrderId(orderId).orElseGet(() -> {
            Payment p = new Payment();
            p.setOrder(order);
            return p;
        });

        String txId = (paymentMethod == PaymentMethod.PAY_AT_SHOP)
                ? "CASH-" + order.getOrderNumber()
                : "TXN-" + System.currentTimeMillis();

        payment.setTransactionId(txId);
        payment.setAmount(order.getTotalPrice());
        payment.setPaymentMethod(paymentMethod);
        payment.setStatus(PaymentStatus.PENDING);

        Payment saved = paymentRepository.save(payment);
        return mapToDTO(saved);
    }

    @Transactional(noRollbackFor = IllegalArgumentException.class)
    public PaymentResponse verifyPayment(UUID orderId, String razorpayPaymentId, String razorpayOrderId, String razorpaySignature) {
        PrintOrder order = printOrderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Order not found with ID: " + orderId));

        if (order.getPaymentMethod() != PaymentMethod.ONLINE) {
            throw new IllegalStateException("Order is not an online payment order");
        }

        // Idempotency check: if order is already PAID, return existing payment without duplicate side-effects
        if (order.getPaymentStatus() == PaymentStatus.PAID) {
            Payment payment = paymentRepository.findByOrderId(orderId).orElseGet(() -> {
                Payment p = new Payment(order, razorpayPaymentId, order.getTotalPrice(), PaymentMethod.ONLINE, PaymentStatus.PAID);
                return paymentRepository.save(p);
            });
            return mapToDTO(payment);
        }

        if (razorpayPaymentId == null || razorpayOrderId == null || razorpaySignature == null) {
            throw new IllegalArgumentException("Missing Razorpay payment verification parameters");
        }

        // Fail closed when only dummy keys are configured — never fake-verify ONLINE payments.
        requireRealRazorpayKeys();

        // C-01: bind the presented razorpayOrderId to the order's stored Razorpay order id.
        if (order.getRazorpayOrderId() == null || !order.getRazorpayOrderId().equals(razorpayOrderId)) {
            throw new IllegalArgumentException("Razorpay order id does not match this order");
        }

        // C-01: verify amount matches the order total before marking PAID.
        // Expected amount in paise derived from the authoritative server-side order total.
        if (order.getTotalPrice() == null || order.getTotalPrice().signum() <= 0) {
            throw new IllegalArgumentException("Order total is invalid for payment verification");
        }

        Payment payment = paymentRepository.findByOrderId(orderId).orElseGet(() -> {
            Payment p = new Payment();
            p.setOrder(order);
            p.setAmount(order.getTotalPrice());
            p.setPaymentMethod(PaymentMethod.ONLINE);
            p.setStatus(PaymentStatus.PENDING);
            return p;
        });

        // C-01: amount/currency binding — a pre-existing payment row must match the
        // authoritative server-side order total; a mismatch implies tampering.
        if (payment.getAmount() == null) {
            payment.setAmount(order.getTotalPrice());
        } else if (payment.getAmount().compareTo(order.getTotalPrice()) != 0) {
            throw new IllegalArgumentException("Payment amount does not match order total");
        }

        boolean isValidSignature = false;
        try {
            JSONObject options = new JSONObject();
            options.put("razorpay_order_id", razorpayOrderId);
            options.put("razorpay_payment_id", razorpayPaymentId);
            options.put("razorpay_signature", razorpaySignature);

            isValidSignature = Utils.verifyPaymentSignature(options, razorpayKeySecret);
        } catch (Exception e) {
            isValidSignature = false;
        }

        if (!isValidSignature) {
            order.setPaymentStatus(PaymentStatus.FAILED);
            payment.setStatus(PaymentStatus.FAILED);
            printOrderRepository.save(order);
            paymentRepository.save(payment);
            throw new IllegalArgumentException("Invalid Razorpay payment signature");
        }

        // Verified successfully
        order.setPaymentStatus(PaymentStatus.PAID);
        order.setRazorpayPaymentId(razorpayPaymentId);
        order.setRazorpaySignature(razorpaySignature);
        printOrderRepository.save(order);

        payment.setStatus(PaymentStatus.PAID);
        payment.setTransactionId(razorpayPaymentId);
        Payment saved = paymentRepository.save(payment);

        // Safe idempotent print job creation
        if (!printJobRepository.existsByOrderId(order.getId())) {
            PrintJob printJob = new PrintJob(order, JobStatus.QUEUED);
            printJobRepository.save(printJob);
        }

        // Broadcast real-time order update to shop admin
        OrderDTO orderDTO = orderService.mapToDTO(order);
        Map<String, Object> event = new HashMap<>();
        event.put("type", "NEW_PRINT_REQUEST");
        event.put("order", orderDTO);
        webSocketService.sendOrderUpdate(order.getShop().getId(), event);

        return mapToDTO(saved);
    }

    @Transactional
    public PaymentResponse cancelPayment(UUID orderId) {
        return cancelPayment(orderId, null);
    }

    @Transactional
    public PaymentResponse cancelPayment(UUID orderId, String razorpayOrderId) {
        PrintOrder order = printOrderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Order not found with ID: " + orderId));

        // C-07: ONLINE cancellations must prove ownership of the Razorpay order —
        // a bare orderId is not sufficient to cancel someone else's online payment.
        // Locally-minted order_test_* ids (test-profile offline flow, no real money)
        // carry no third-party proof value and keep the legacy bare-cancel path.
        if (order.getPaymentMethod() == PaymentMethod.ONLINE && order.getRazorpayOrderId() != null
                && !order.getRazorpayOrderId().startsWith("order_test_")) {
            if (razorpayOrderId == null || !order.getRazorpayOrderId().equals(razorpayOrderId)) {
                throw new IllegalArgumentException("Razorpay order id is required to cancel this online payment");
            }
        }

        if (order.getPaymentStatus() == PaymentStatus.PENDING) {
            order.setPaymentStatus(PaymentStatus.FAILED);
            printOrderRepository.save(order);

            Payment payment = paymentRepository.findByOrderId(orderId).orElseGet(() -> {
                Payment p = new Payment();
                p.setOrder(order);
                p.setAmount(order.getTotalPrice());
                p.setPaymentMethod(order.getPaymentMethod());
                return p;
            });
            payment.setStatus(PaymentStatus.FAILED);
            Payment saved = paymentRepository.save(payment);
            return mapToDTO(saved);
        }

        Payment payment = paymentRepository.findByOrderId(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Payment not found"));
        return mapToDTO(payment);
    }

    @Transactional
    public void handleWebhook(String rawPayload, String signatureHeader) {
        // Fail closed when the webhook secret is not really configured (non-test):
        // an empty/dummy secret would make signature checks forgeable.
        if (!isTestProfile()
                && (razorpayWebhookSecret == null || razorpayWebhookSecret.isBlank()
                    || "dummy_webhook_secret".equals(razorpayWebhookSecret))) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Payment webhooks are unavailable: webhook secret is not configured");
        }
        if (signatureHeader == null || signatureHeader.trim().isEmpty()) {
            throw new IllegalArgumentException("Missing Razorpay webhook signature header");
        }

        try {
            boolean isValid = Utils.verifyWebhookSignature(rawPayload, signatureHeader, razorpayWebhookSecret);
            if (!isValid) {
                throw new IllegalArgumentException("Invalid Razorpay webhook signature");
            }
        } catch (Exception e) {
            throw new IllegalArgumentException("Webhook verification failed: " + e.getMessage());
        }

        JSONObject payloadJson = new JSONObject(rawPayload);
        String eventType = payloadJson.optString("event");

        if ("payment.captured".equals(eventType) || "order.paid".equals(eventType)) {
            JSONObject payload = payloadJson.optJSONObject("payload");
            if (payload != null) {
                JSONObject paymentObj = payload.optJSONObject("payment");
                JSONObject paymentEntity = paymentObj != null ? paymentObj.optJSONObject("entity") : null;

                String razorpayOrderId = null;
                String razorpayPaymentId = null;
                long capturedAmountPaise = -1;

                if (paymentEntity != null) {
                    razorpayOrderId = paymentEntity.optString("order_id");
                    razorpayPaymentId = paymentEntity.optString("id");
                    capturedAmountPaise = paymentEntity.optLong("amount", -1);
                } else {
                    JSONObject orderObj = payload.optJSONObject("order");
                    JSONObject orderEntity = orderObj != null ? orderObj.optJSONObject("entity") : null;
                    if (orderEntity != null) {
                        razorpayOrderId = orderEntity.optString("id");
                    }
                }

                if (razorpayOrderId != null && !razorpayOrderId.isEmpty()) {
                    PrintOrder order = printOrderRepository.findByRazorpayOrderId(razorpayOrderId).orElse(null);
                    if (order != null && order.getPaymentStatus() != PaymentStatus.PAID) {
                        // Amount binding: the captured amount (paise) must cover the
                        // authoritative server-side order total — never mark PAID on
                        // a partial/under-paid capture.
                        if (capturedAmountPaise >= 0 && order.getTotalPrice() != null) {
                            long expectedPaise = order.getTotalPrice()
                                    .multiply(new java.math.BigDecimal("100")).longValue();
                            if (capturedAmountPaise < expectedPaise) {
                                return;
                            }
                        }
                        order.setPaymentStatus(PaymentStatus.PAID);
                        if (razorpayPaymentId != null) {
                            order.setRazorpayPaymentId(razorpayPaymentId);
                        }
                        printOrderRepository.save(order);

                        Payment payment = paymentRepository.findByOrderId(order.getId()).orElseGet(() -> {
                            Payment p = new Payment();
                            p.setOrder(order);
                            p.setAmount(order.getTotalPrice());
                            p.setPaymentMethod(PaymentMethod.ONLINE);
                            return p;
                        });
                        payment.setStatus(PaymentStatus.PAID);
                        if (razorpayPaymentId != null) {
                            payment.setTransactionId(razorpayPaymentId);
                        }
                        paymentRepository.save(payment);

                        if (!printJobRepository.existsByOrderId(order.getId())) {
                            PrintJob printJob = new PrintJob(order, JobStatus.QUEUED);
                            printJobRepository.save(printJob);
                        }

                        OrderDTO orderDTO = orderService.mapToDTO(order);
                        Map<String, Object> wsEvent = new HashMap<>();
                        wsEvent.put("type", "NEW_PRINT_REQUEST");
                        wsEvent.put("order", orderDTO);
                        webSocketService.sendOrderUpdate(order.getShop().getId(), wsEvent);
                    }
                }
            }
        } else if ("payment.failed".equals(eventType)) {
            JSONObject payload = payloadJson.optJSONObject("payload");
            if (payload != null) {
                JSONObject paymentObj = payload.optJSONObject("payment");
                JSONObject paymentEntity = paymentObj != null ? paymentObj.optJSONObject("entity") : null;
                if (paymentEntity != null) {
                    String razorpayOrderId = paymentEntity.optString("order_id");
                    if (razorpayOrderId != null) {
                        PrintOrder order = printOrderRepository.findByRazorpayOrderId(razorpayOrderId).orElse(null);
                        if (order != null && order.getPaymentStatus() == PaymentStatus.PENDING) {
                            order.setPaymentStatus(PaymentStatus.FAILED);
                            printOrderRepository.save(order);

                            Payment payment = paymentRepository.findByOrderId(order.getId()).orElse(null);
                            if (payment != null) {
                                payment.setStatus(PaymentStatus.FAILED);
                                paymentRepository.save(payment);
                            }
                        }
                    }
                }
            }
        }
    }

    public PaymentResponse mapToDTO(Payment payment) {
        PaymentResponse dto = new PaymentResponse();
        dto.setId(payment.getId());
        dto.setOrderId(payment.getOrder().getId());
        dto.setTransactionId(payment.getTransactionId());
        dto.setAmount(payment.getAmount());
        dto.setPaymentMethod(payment.getPaymentMethod());
        dto.setStatus(payment.getStatus());
        return dto;
    }
}
