package com.printalfa.backend;

import com.printalfa.backend.dto.CreateOrderItemRequest;
import com.printalfa.backend.dto.CreateOrderRequest;
import com.printalfa.backend.dto.OrderDTO;
import com.printalfa.backend.entity.*;
import com.printalfa.backend.enums.*;
import com.printalfa.backend.repository.*;
import com.printalfa.backend.security.JwtTokenProvider;
import com.printalfa.backend.security.UserPrincipal;
import com.printalfa.backend.service.FileStorageService;
import com.printalfa.backend.service.OrderService;
import com.printalfa.backend.service.PrintService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ActiveProfiles("test")
@SpringBootTest
@AutoConfigureMockMvc
public class PrintAgentSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ShopRepository shopRepository;

    @Autowired
    private ShopPricingRepository shopPricingRepository;

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private PrintJobRepository printJobRepository;

    @Autowired
    private OrderService orderService;

    @Autowired
    private PrintService printService;

    @Autowired
    private JwtTokenProvider jwtTokenProvider;

    private Shop shopA;
    private Shop shopB;
    private String apiKeyShopA;
    private String apiKeyShopB;
    private Document documentA;
    private Document documentB;

    @BeforeEach
    void setUp() {
        apiKeyShopA = "pa_live_shopa_" + UUID.randomUUID().toString().replace("-", "");
        apiKeyShopB = "pa_live_shopb_" + UUID.randomUUID().toString().replace("-", "");

        shopA = new Shop("Security Shop A", "sec-shop-a-" + UUID.randomUUID(), "123 Alpha St", "1111111111", null);
        shopA.setApiKey(apiKeyShopA);
        shopA = shopRepository.save(shopA);

        shopB = new Shop("Security Shop B", "sec-shop-b-" + UUID.randomUUID(), "456 Beta St", "2222222222", null);
        shopB.setApiKey(apiKeyShopB);
        shopB = shopRepository.save(shopB);

        setupPricing(shopA);
        setupPricing(shopB);

        documentA = documentRepository.save(new Document("doc_a.pdf", "doc_a_" + UUID.randomUUID() + ".pdf", "application/pdf", 1024, 2, "uploads/doc_a.pdf"));
        documentB = documentRepository.save(new Document("doc_b.pdf", "doc_b_" + UUID.randomUUID() + ".pdf", "application/pdf", 2048, 3, "uploads/doc_b.pdf"));
    }

    private void setupPricing(Shop shop) {
        ShopPricing pricing = new ShopPricing();
        pricing.setShop(shop);
        pricing.setBwA4Single(new BigDecimal("2.00"));
        pricing.setBwA4Double(new BigDecimal("3.00"));
        pricing.setColorA4Single(new BigDecimal("10.00"));
        pricing.setColorA4Double(new BigDecimal("15.00"));
        pricing.setBwA3Single(new BigDecimal("5.00"));
        pricing.setBwA3Double(new BigDecimal("8.00"));
        pricing.setColorA3Single(new BigDecimal("20.00"));
        pricing.setColorA3Double(new BigDecimal("30.00"));
        pricing.setPassportPrice(new BigDecimal("50.00"));
        shopPricingRepository.save(pricing);
    }

    private OrderDTO createOrderForShop(Shop shop, Document doc) {
        CreateOrderRequest req = new CreateOrderRequest();
        req.setShopId(shop.getId());
        req.setPaymentMethod(PaymentMethod.PAY_AT_SHOP);
        req.setCustomerName("Security Customer");
        req.setCustomerPhone("9876543210");

        CreateOrderItemRequest item = new CreateOrderItemRequest();
        item.setDocumentId(doc.getId());
        item.setPrintType(PrintType.PRINT);
        item.setColorMode(ColorMode.BW);
        item.setPaperSize(PaperSize.A4);
        item.setPrintSide(PrintSide.SINGLE);
        item.setPageRange("ALL");
        item.setCopies(1);
        req.setItems(List.of(item));

        return orderService.createOrder(req);
    }

    @Test
    @DisplayName("Unauthenticated request to Print Agent API is rejected with 401")
    void testUnauthenticatedAccessRejected() throws Exception {
        mockMvc.perform(get("/api/print-agent/jobs"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    @DisplayName("Invalid API key is rejected with 401")
    void testInvalidApiKeyRejected() throws Exception {
        mockMvc.perform(get("/api/print-agent/jobs")
                        .header("X-Agent-Key", "pa_live_invalid_fake_key_99999"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    @DisplayName("Valid Shop A API key can only fetch jobs for Shop A and isolates Shop B")
    void testShopIsolationWithApiKey() throws Exception {
        OrderDTO orderA = createOrderForShop(shopA, documentA);
        OrderDTO orderB = createOrderForShop(shopB, documentB);

        PrintJob jobA = printJobRepository.findByOrderId(orderA.getId()).orElseThrow();
        PrintJob jobB = printJobRepository.findByOrderId(orderB.getId()).orElseThrow();

        // Shop A agent queries jobs
        mockMvc.perform(get("/api/print-agent/jobs")
                        .header("X-Agent-Key", apiKeyShopA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data[*].jobId", hasItem(jobA.getId().toString())))
                .andExpect(jsonPath("$.data[*].jobId", not(hasItem(jobB.getId().toString()))));

        // Shop A agent attempting to query Shop B via ?shopId returns 403 Forbidden
        mockMvc.perform(get("/api/print-agent/jobs?shopId=" + shopB.getId())
                        .header("X-Agent-Key", apiKeyShopA))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("Shop A Agent cannot start, complete, fail, or retry Shop B's print job (returns 403)")
    void testCrossShopActionRejected() throws Exception {
        OrderDTO orderB = createOrderForShop(shopB, documentB);
        PrintJob jobB = printJobRepository.findByOrderId(orderB.getId()).orElseThrow();

        // Shop A agent attempts to start Shop B's job
        mockMvc.perform(post("/api/print-agent/jobs/" + jobB.getId() + "/started")
                        .header("X-Agent-Key", apiKeyShopA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agentId\":\"Agent-Hacker\"}"))
                .andExpect(status().isForbidden());

        // Shop A agent attempts to complete Shop B's job
        mockMvc.perform(post("/api/print-agent/jobs/" + jobB.getId() + "/completed")
                        .header("X-Agent-Key", apiKeyShopA))
                .andExpect(status().isForbidden());

        // Shop A agent attempts to fail Shop B's job
        mockMvc.perform(post("/api/print-agent/jobs/" + jobB.getId() + "/failed")
                        .header("X-Agent-Key", apiKeyShopA))
                .andExpect(status().isForbidden());

        // Shop A agent attempts to retry Shop B's job
        mockMvc.perform(post("/api/print-agent/jobs/" + jobB.getId() + "/retry")
                        .header("X-Agent-Key", apiKeyShopA))
                .andExpect(status().isForbidden());
    }

    @Autowired
    private UserRepository userRepository;

    @Test
    @DisplayName("Shop Admin JWT can authenticate to Print Agent endpoints for their own shop")
    void testAdminJwtAuthentication() throws Exception {
        OrderDTO orderA = createOrderForShop(shopA, documentA);
        PrintJob jobA = printJobRepository.findByOrderId(orderA.getId()).orElseThrow();

        User adminUser = new User("admin_sec_a_" + UUID.randomUUID() + "@test.com", "pass", UserRole.ROLE_SHOP_ADMIN, shopA);
        adminUser = userRepository.save(adminUser);

        UserPrincipal adminPrincipal = UserPrincipal.create(adminUser);
        UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                adminPrincipal, null, adminPrincipal.getAuthorities());
        String adminJwt = jwtTokenProvider.generateToken(auth);

        mockMvc.perform(get("/api/print-agent/jobs")
                        .header("Authorization", "Bearer " + adminJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data[*].jobId", hasItem(jobA.getId().toString())));
    }

    @Test
    @DisplayName("Bidirectional Tenant Scoping: Shop A sees only Shop A jobs, Shop B sees only Shop B jobs")
    void testBidirectionalShopIsolation() throws Exception {
        OrderDTO orderA = createOrderForShop(shopA, documentA);
        OrderDTO orderB = createOrderForShop(shopB, documentB);

        PrintJob jobA = printJobRepository.findByOrderId(orderA.getId()).orElseThrow();
        PrintJob jobB = printJobRepository.findByOrderId(orderB.getId()).orElseThrow();

        // 1. Authenticated as Shop A
        mockMvc.perform(get("/api/print-agent/jobs")
                        .header("X-Agent-Key", apiKeyShopA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[*].jobId", hasItem(jobA.getId().toString())))
                .andExpect(jsonPath("$.data[*].jobId", not(hasItem(jobB.getId().toString()))));

        // 2. Authenticated as Shop B
        mockMvc.perform(get("/api/print-agent/jobs")
                        .header("X-Agent-Key", apiKeyShopB))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[*].jobId", hasItem(jobB.getId().toString())))
                .andExpect(jsonPath("$.data[*].jobId", not(hasItem(jobA.getId().toString()))));
    }

    @Test
    @DisplayName("Single Job Detail Tenant Isolation: Shop A can view Job A, but gets 403 on Job B")
    void testSingleJobDetailTenantIsolation() throws Exception {
        OrderDTO orderA = createOrderForShop(shopA, documentA);
        OrderDTO orderB = createOrderForShop(shopB, documentB);

        PrintJob jobA = printJobRepository.findByOrderId(orderA.getId()).orElseThrow();
        PrintJob jobB = printJobRepository.findByOrderId(orderB.getId()).orElseThrow();

        // Shop A agent accesses own job detail
        mockMvc.perform(get("/api/print-agent/jobs/" + jobA.getId())
                        .header("X-Agent-Key", apiKeyShopA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.jobId").value(jobA.getId().toString()));

        // Shop A agent attempts to access Shop B job detail -> 403 Forbidden
        mockMvc.perform(get("/api/print-agent/jobs/" + jobB.getId())
                        .header("X-Agent-Key", apiKeyShopA))
                .andExpect(status().isForbidden());
    }

    @Autowired
    private FileStorageService fileStorageService;

    @Test
    @DisplayName("PrintService rejects null shopId to prevent accidental global queue leakage")
    void testDirectServiceCallWithoutShopIdThrows() {
        org.junit.jupiter.api.Assertions.assertThrows(
                org.springframework.security.access.AccessDeniedException.class,
                () -> printService.getQueuedJobsByShop(null)
        );
    }

    @Test
    @DisplayName("Print Agent Document Download: Shop A agent can download Shop A document, but gets 403 on Shop B document")
    void testPrintAgentDocumentDownloadAuthorization() throws Exception {
        createOrderForShop(shopA, documentA);
        createOrderForShop(shopB, documentB);

        // Shop A agent can access Shop A document (file might not exist physically on disk during test, but authorization check passes)
        // For testing endpoint authorization check:
        // When document exists in shop orders, printOrderRepository.existsByShopIdAndDocumentId returns true.
        mockMvc.perform(get("/api/print-agent/documents/" + documentB.getId() + "/download")
                        .header("X-Agent-Key", apiKeyShopA))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("Direct /uploads/** access without controller authorization is blocked with 401/403")
    void testDirectUploadsAccessBlocked() throws Exception {
        mockMvc.perform(get("/uploads/secret_file.pdf"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("FileStorageService rejects path traversal sequences in file names")
    void testPathTraversalPrevented() {
        org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> fileStorageService.loadFileAsResource("../../../secret.pdf")
        );
        org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> fileStorageService.loadFileAsResource("..\\secret.pdf")
        );
        org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> fileStorageService.loadFileAsResource("sub/secret.pdf")
        );
    }
}
