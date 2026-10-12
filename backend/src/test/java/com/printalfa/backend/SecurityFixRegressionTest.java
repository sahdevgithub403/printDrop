package com.printalfa.backend;

import com.printalfa.backend.dto.CreateOrderItemRequest;
import com.printalfa.backend.dto.CreateOrderRequest;
import com.printalfa.backend.dto.OrderDTO;
import com.printalfa.backend.entity.Document;
import com.printalfa.backend.entity.Shop;
import com.printalfa.backend.entity.ShopPricing;
import com.printalfa.backend.enums.*;
import com.printalfa.backend.repository.DocumentRepository;
import com.printalfa.backend.repository.PrintJobRepository;
import com.printalfa.backend.repository.PrintOrderRepository;
import com.printalfa.backend.repository.ShopPricingRepository;
import com.printalfa.backend.repository.ShopRepository;
import com.printalfa.backend.service.FileStorageService;
import com.printalfa.backend.service.OrderService;
import com.printalfa.backend.service.PaymentService;
import org.json.JSONObject;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
public class SecurityFixRegressionTest {

    @Autowired
    private OrderService orderService;

    @Autowired
    private PaymentService paymentService;

    @Autowired
    private FileStorageService fileStorageService;

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

    @Value("${razorpay.webhook-secret:dummy_webhook_secret}")
    private String razorpayWebhookSecret;

    private Shop testShop;
    private Document testDoc;

    @BeforeEach
    void setUp() {
        printJobRepository.deleteAll();
        paymentRepository.deleteAll();
        printOrderRepository.deleteAll();

        testShop = new Shop("Regression Shop", "regression-shop-" + UUID.randomUUID(), "1 Test Rd", "9998887776", null);
        testShop = shopRepository.save(testShop);

        ShopPricing pricing = new ShopPricing(testShop,
                new BigDecimal("2.00"), new BigDecimal("3.50"),
                new BigDecimal("10.00"), new BigDecimal("18.00"),
                new BigDecimal("5.00"), new BigDecimal("9.00"),
                new BigDecimal("20.00"), new BigDecimal("35.00"),
                new BigDecimal("50.00"));
        shopPricingRepository.save(pricing);

        testDoc = new Document("test.pdf", "regression_" + UUID.randomUUID() + ".pdf", "application/pdf", 1024L, 4, "regression.pdf");
        testDoc = documentRepository.save(testDoc);
    }

    private CreateOrderRequest orderRequest(PaymentMethod method) {
        CreateOrderItemRequest item = new CreateOrderItemRequest();
        item.setDocumentId(testDoc.getId());
        item.setPrintType(PrintType.PRINT);
        item.setColorMode(ColorMode.BW);
        item.setPaperSize(PaperSize.A4);
        item.setPrintSide(PrintSide.SINGLE);
        item.setPageRange("ALL");
        item.setCopies(1);
        CreateOrderRequest req = new CreateOrderRequest();
        req.setShopId(testShop.getId());
        req.setPaymentMethod(method);
        req.setCustomerName("Reg Tester");
        req.setCustomerPhone("9000000001");
        req.setItems(List.of(item));
        return req;
    }

    @Test
    void unpaidOnlineItemCannotMoveToPrinting() {
        OrderDTO order = orderService.createOrder(orderRequest(PaymentMethod.ONLINE));
        UUID itemId = order.getItems().get(0).getId();

        IllegalStateException ex = assertThrows(IllegalStateException.class, () ->
                orderService.updateItemPrintStatus(order.getId(), itemId, PrintStatus.PRINTING, testShop.getId()));
        assertTrue(ex.getMessage().contains("PAID"));

        // Order-level status must be unchanged.
        assertEquals(PrintStatus.PENDING,
                orderService.getOrderById(order.getId()).getPrintStatus());
    }

    @Test
    void itemStatusRejectsTerminalTransition() {
        OrderDTO order = orderService.createOrder(orderRequest(PaymentMethod.PAY_AT_SHOP));
        UUID itemId = order.getItems().get(0).getId();

        // PENDING -> COMPLETED is allowed; COMPLETED -> PENDING is terminal and must fail.
        orderService.updateItemPrintStatus(order.getId(), itemId, PrintStatus.COMPLETED, testShop.getId());
        assertThrows(IllegalStateException.class, () ->
                orderService.updateItemPrintStatus(order.getId(), itemId, PrintStatus.PENDING, testShop.getId()));
    }

    @Test
    void invalidStatusFilterIsRejected() {
        assertThrows(IllegalArgumentException.class, () ->
                orderService.getShopOrders(testShop.getId(), "NOT_A_STATUS"));
    }

    @Test
    void webhookUnderpaidCaptureDoesNotMarkPaid() throws Exception {
        OrderDTO order = orderService.createOrder(orderRequest(PaymentMethod.ONLINE));
        long expectedPaise = order.getTotalPrice().multiply(new BigDecimal("100")).longValue();
        assertTrue(expectedPaise > 100);

        JSONObject entity = new JSONObject();
        entity.put("id", "pay_underpaid1");
        entity.put("order_id", order.getRazorpayOrderId());
        entity.put("amount", 100); // deliberately less than the order total
        JSONObject payment = new JSONObject();
        payment.put("entity", entity);
        JSONObject payload = new JSONObject();
        payload.put("payment", payment);
        JSONObject root = new JSONObject();
        root.put("event", "payment.captured");
        root.put("payload", payload);
        String raw = root.toString();

        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(razorpayWebhookSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String sig = HexFormat.of().formatHex(mac.doFinal(raw.getBytes(StandardCharsets.UTF_8)));

        paymentService.handleWebhook(raw, sig);

        assertEquals(PaymentStatus.PENDING,
                orderService.getOrderById(order.getId()).getPaymentStatus());
        assertFalse(printJobRepository.existsByOrderId(order.getId()));
    }

    @Test
    void spoofedDocUploadIsRejected() {
        // Bytes are plain text, not an OLE compound document.
        MockMultipartFile fakeDoc = new MockMultipartFile(
                "file", "evil.doc", "application/msword",
                "This is not an OLE document at all".getBytes(StandardCharsets.UTF_8));
        assertThrows(IllegalArgumentException.class, () ->
                fileStorageService.uploadFile(fakeDoc, testShop.getId()));

        MockMultipartFile fakeDocx = new MockMultipartFile(
                "file", "evil.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "Not a ZIP archive".getBytes(StandardCharsets.UTF_8));
        assertThrows(IllegalArgumentException.class, () ->
                fileStorageService.uploadFile(fakeDocx, testShop.getId()));
    }
}
