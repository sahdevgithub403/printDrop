package com.printalfa.backend;

import com.printalfa.backend.dto.CreateOrderItemRequest;
import com.printalfa.backend.dto.CreateOrderRequest;
import com.printalfa.backend.dto.OrderDTO;
import com.printalfa.backend.dto.PaymentResponse;
import com.printalfa.backend.entity.Document;
import com.printalfa.backend.entity.PrintOrder;
import com.printalfa.backend.entity.Shop;
import com.printalfa.backend.entity.ShopPricing;
import com.printalfa.backend.enums.*;
import com.printalfa.backend.repository.DocumentRepository;
import com.printalfa.backend.repository.PrintJobRepository;
import com.printalfa.backend.repository.PrintOrderRepository;
import com.printalfa.backend.repository.ShopPricingRepository;
import com.printalfa.backend.repository.ShopRepository;
import com.printalfa.backend.service.OrderService;
import com.printalfa.backend.service.PaymentService;
import org.json.JSONObject;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.SignatureException;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
public class PaymentSecurityAndWorkflowTest {

    @Autowired
    private OrderService orderService;

    @Autowired
    private PaymentService paymentService;

    @Autowired
    private ShopRepository shopRepository;

    @Autowired
    private ShopPricingRepository shopPricingRepository;

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private PrintOrderRepository printOrderRepository;

    @Autowired
    private PrintJobRepository printJobRepository;

    @Autowired
    private com.printalfa.backend.repository.PaymentRepository paymentRepository;

    @Value("${razorpay.key-secret}")
    private String razorpayKeySecret;

    @Value("${razorpay.webhook-secret:dummy_webhook_secret}")
    private String razorpayWebhookSecret;

    private Shop testShop;
    private Document testDoc;

    @BeforeEach
    void setUp() {
        printJobRepository.deleteAll();
        paymentRepository.deleteAll();
        printOrderRepository.deleteAll();

        testShop = new Shop("Payment Test Shop", "payment-shop-" + UUID.randomUUID(), "123 Main St", "9998887776", "http://logo.png");
        testShop = shopRepository.save(testShop);

        ShopPricing pricing = new ShopPricing(testShop,
                new BigDecimal("2.00"), new BigDecimal("3.50"),
                new BigDecimal("10.00"), new BigDecimal("18.00"),
                new BigDecimal("5.00"), new BigDecimal("9.00"),
                new BigDecimal("20.00"), new BigDecimal("35.00"),
                new BigDecimal("50.00"));
        shopPricingRepository.save(pricing);

        testDoc = new Document("test.pdf", "test_file_" + UUID.randomUUID() + ".pdf", "application/pdf", 1024L, 4, "/tmp/test.pdf");
        testDoc = documentRepository.save(testDoc);
    }

    private CreateOrderItemRequest createItemRequest(UUID docId) {
        CreateOrderItemRequest item = new CreateOrderItemRequest();
        item.setDocumentId(docId);
        item.setPrintType(PrintType.PRINT);
        item.setColorMode(ColorMode.BW);
        item.setPaperSize(PaperSize.A4);
        item.setPrintSide(PrintSide.SINGLE);
        item.setPageRange("ALL");
        item.setCopies(1);
        return item;
    }

    private CreateOrderRequest createOrderRequest(Shop shop, Document doc, PaymentMethod paymentMethod, String name, String phone) {
        CreateOrderRequest req = new CreateOrderRequest();
        req.setShopId(shop.getId());
        req.setPaymentMethod(paymentMethod);
        req.setCustomerName(name);
        req.setCustomerPhone(phone);
        req.setItems(List.of(createItemRequest(doc.getId())));
        return req;
    }

    private String generateHmacSha256(String data, String secret) throws SignatureException {
        try {
            SecretKeySpec signingKey = new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(signingKey);
            byte[] rawHmac = mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(rawHmac);
        } catch (Exception e) {
            throw new SignatureException("Failed to generate HMAC: " + e.getMessage());
        }
    }

    @Test
    void testPayAtShopOrderEnqueuesPrintJobImmediately() {
        CreateOrderRequest req = createOrderRequest(testShop, testDoc, PaymentMethod.PAY_AT_SHOP, "Alice", "9876543210");
        OrderDTO orderDTO = orderService.createOrder(req);

        assertEquals(PaymentMethod.PAY_AT_SHOP, orderDTO.getPaymentMethod());
        assertEquals(PaymentStatus.PENDING, orderDTO.getPaymentStatus());

        // Pay-at-shop orders are immediately eligible and enqueued in print queue
        assertTrue(printJobRepository.existsByOrderId(orderDTO.getId()));
    }

    @Test
    void testOnlineOrderPendingDoesNotEnqueuePrintJob() {
        CreateOrderRequest req = createOrderRequest(testShop, testDoc, PaymentMethod.ONLINE, "Bob", "9876543211");
        OrderDTO orderDTO = orderService.createOrder(req);

        assertEquals(PaymentMethod.ONLINE, orderDTO.getPaymentMethod());
        assertEquals(PaymentStatus.PENDING, orderDTO.getPaymentStatus());
        assertNotNull(orderDTO.getRazorpayOrderId());

        // Unpaid online orders must NOT enter print queue!
        assertFalse(printJobRepository.existsByOrderId(orderDTO.getId()),
                "Unpaid online order must NOT have a PrintJob before payment verification");
    }

    @Test
    void testOnlineOrderSuccessfulVerificationEnqueuesPrintJob() throws Exception {
        CreateOrderRequest req = createOrderRequest(testShop, testDoc, PaymentMethod.ONLINE, "Charlie", "9876543212");
        OrderDTO orderDTO = orderService.createOrder(req);
        UUID orderId = orderDTO.getId();
        String rzpOrderId = orderDTO.getRazorpayOrderId();
        String rzpPaymentId = "pay_test_" + System.currentTimeMillis();

        String payload = rzpOrderId + "|" + rzpPaymentId;
        String validSignature = generateHmacSha256(payload, razorpayKeySecret);

        PaymentResponse paymentResponse = paymentService.verifyPayment(orderId, rzpPaymentId, rzpOrderId, validSignature);

        assertEquals(PaymentStatus.PAID, paymentResponse.getStatus());
        assertEquals(rzpPaymentId, paymentResponse.getTransactionId());

        PrintOrder orderAfter = printOrderRepository.findById(orderId).orElseThrow();
        assertEquals(PaymentStatus.PAID, orderAfter.getPaymentStatus());
        assertEquals(rzpPaymentId, orderAfter.getRazorpayPaymentId());

        // Now print job must be enqueued in QUEUED status
        assertTrue(printJobRepository.existsByOrderId(orderId), "Verified paid order must be enqueued for printing");
    }

    @Test
    void testOnlineOrderInvalidSignatureRejectsAndMarksFailed() {
        CreateOrderRequest req = createOrderRequest(testShop, testDoc, PaymentMethod.ONLINE, "David", "9876543213");
        OrderDTO orderDTO = orderService.createOrder(req);
        UUID orderId = orderDTO.getId();
        String rzpOrderId = orderDTO.getRazorpayOrderId();
        String rzpPaymentId = "pay_forged_123";
        String invalidSignature = "invalid_fake_signature_hex_123456";

        assertThrows(IllegalArgumentException.class, () -> {
            paymentService.verifyPayment(orderId, rzpPaymentId, rzpOrderId, invalidSignature);
        });

        PrintOrder orderAfter = printOrderRepository.findById(orderId).orElseThrow();
        assertEquals(PaymentStatus.FAILED, orderAfter.getPaymentStatus());
        assertFalse(printJobRepository.existsByOrderId(orderId), "Failed payment must not create print job");
    }

    @Test
    void testPaymentVerificationIdempotency() throws Exception {
        CreateOrderRequest req = createOrderRequest(testShop, testDoc, PaymentMethod.ONLINE, "Emma", "9876543214");
        OrderDTO orderDTO = orderService.createOrder(req);
        UUID orderId = orderDTO.getId();
        String rzpOrderId = orderDTO.getRazorpayOrderId();
        String rzpPaymentId = "pay_idempotent_" + System.currentTimeMillis();
        String signature = generateHmacSha256(rzpOrderId + "|" + rzpPaymentId, razorpayKeySecret);

        // First verification
        PaymentResponse res1 = paymentService.verifyPayment(orderId, rzpPaymentId, rzpOrderId, signature);
        assertEquals(PaymentStatus.PAID, res1.getStatus());

        // Repeated verification (idempotent)
        PaymentResponse res2 = paymentService.verifyPayment(orderId, rzpPaymentId, rzpOrderId, signature);
        assertEquals(PaymentStatus.PAID, res2.getStatus());

        // Ensure only exactly 1 print job was created
        assertEquals(1, printJobRepository.count());
    }

    @Test
    void testPaymentCancellationMarksFailedAndDoesNotPrint() {
        CreateOrderRequest req = createOrderRequest(testShop, testDoc, PaymentMethod.ONLINE, "Frank", "9876543215");
        OrderDTO orderDTO = orderService.createOrder(req);
        UUID orderId = orderDTO.getId();

        PaymentResponse cancelRes = paymentService.cancelPayment(orderId);
        assertEquals(PaymentStatus.FAILED, cancelRes.getStatus());

        PrintOrder orderAfter = printOrderRepository.findById(orderId).orElseThrow();
        assertEquals(PaymentStatus.FAILED, orderAfter.getPaymentStatus());
        assertFalse(printJobRepository.existsByOrderId(orderId));
    }

    @Test
    void testWebhookPaymentCapturedIdempotentProcessing() throws Exception {
        CreateOrderRequest req = createOrderRequest(testShop, testDoc, PaymentMethod.ONLINE, "Grace", "9876543216");
        OrderDTO orderDTO = orderService.createOrder(req);
        String rzpOrderId = orderDTO.getRazorpayOrderId();
        String rzpPaymentId = "pay_webhook_" + System.currentTimeMillis();

        JSONObject paymentEntity = new JSONObject();
        paymentEntity.put("id", rzpPaymentId);
        paymentEntity.put("order_id", rzpOrderId);
        paymentEntity.put("status", "captured");

        JSONObject paymentWrapper = new JSONObject();
        paymentWrapper.put("entity", paymentEntity);

        JSONObject payloadWrapper = new JSONObject();
        payloadWrapper.put("payment", paymentWrapper);

        JSONObject webhookJson = new JSONObject();
        webhookJson.put("event", "payment.captured");
        webhookJson.put("payload", payloadWrapper);

        String rawPayload = webhookJson.toString();
        String signature = generateHmacSha256(rawPayload, razorpayWebhookSecret);

        // First webhook delivery
        paymentService.handleWebhook(rawPayload, signature);

        PrintOrder orderAfter = printOrderRepository.findById(orderDTO.getId()).orElseThrow();
        assertEquals(PaymentStatus.PAID, orderAfter.getPaymentStatus());
        assertTrue(printJobRepository.existsByOrderId(orderDTO.getId()));

        // Second duplicate webhook delivery (idempotency check)
        paymentService.handleWebhook(rawPayload, signature);

        assertEquals(1, printJobRepository.count());
    }

    @Test
    void testWebhookInvalidSignatureRejected() {
        JSONObject webhookJson = new JSONObject();
        webhookJson.put("event", "payment.captured");
        String rawPayload = webhookJson.toString();

        assertThrows(IllegalArgumentException.class, () -> {
            paymentService.handleWebhook(rawPayload, "invalid_signature");
        });
    }
}
