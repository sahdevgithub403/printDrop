package com.printalfa.backend;

import com.printalfa.backend.dto.CreateOrderItemRequest;
import com.printalfa.backend.dto.CreateOrderRequest;
import com.printalfa.backend.dto.OrderDTO;
import com.printalfa.backend.dto.PrintJobDTO;
import com.printalfa.backend.entity.*;
import com.printalfa.backend.enums.*;
import com.printalfa.backend.repository.*;
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
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ActiveProfiles("test")
@SpringBootTest
@AutoConfigureMockMvc
public class PrintJobLifecycleTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private OrderService orderService;

    @Autowired
    private PrintService printService;

    @Autowired
    private ShopRepository shopRepository;

    @Autowired
    private ShopPricingRepository shopPricingRepository;

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private PrintJobRepository printJobRepository;

    @Autowired
    private PrintOrderRepository printOrderRepository;

    private Shop shop;
    private Document document;

    @BeforeEach
    void setUp() {
        shop = shopRepository.save(new Shop("Print Shop Life", "shop-life-" + UUID.randomUUID(), "Main St", "9999999999", null));

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

        document = documentRepository.save(new Document("doc_life.pdf", "doc_life_" + UUID.randomUUID() + ".pdf", "application/pdf", 2048, 4, "uploads/doc_life.pdf"));
    }

    private OrderDTO createTestOrder() {
        CreateOrderRequest req = new CreateOrderRequest();
        req.setShopId(shop.getId());
        req.setPaymentMethod(PaymentMethod.PAY_AT_SHOP);
        req.setCustomerName("Lifecycle Test Customer");
        req.setCustomerPhone("9876543210");

        CreateOrderItemRequest item = new CreateOrderItemRequest();
        item.setDocumentId(document.getId());
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
    @DisplayName("Complete Print Job Lifecycle: QUEUED -> PROCESSING -> COMPLETED")
    void testCompletePrintJobLifecycle() throws Exception {
        // 1. Create order
        OrderDTO order = createTestOrder();
        assertNotNull(order.getId());
        assertEquals(PrintStatus.PENDING, order.getPrintStatus());

        // 2. Check PrintJob is created with QUEUED status
        PrintJob job = printJobRepository.findByOrderId(order.getId())
                .orElseThrow(() -> new AssertionError("PrintJob should be created"));
        assertEquals(JobStatus.QUEUED, job.getStatus());

        // 3. Print Agent discovers job in queue
        mockMvc.perform(get("/api/print-agent/jobs?shopId=" + shop.getId())
                        .header("X-Agent-Key", shop.getApiKey()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data", hasSize(greaterThanOrEqualTo(1))))
                .andExpect(jsonPath("$.data[?(@.jobId == '" + job.getId() + "')].status").value("QUEUED"));

        // 4. Print Agent claims job (started)
        mockMvc.perform(post("/api/print-agent/jobs/" + job.getId() + "/started")
                        .header("X-Agent-Key", shop.getApiKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agentId\":\"Agent-01\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.status").value("PROCESSING"))
                .andExpect(jsonPath("$.data.assignedAgentId").value("Agent-01"));

        // Verify order print status moved to PRINTING
        PrintOrder updatedOrder = printOrderRepository.findById(order.getId()).orElseThrow();
        assertEquals(PrintStatus.PRINTING, updatedOrder.getPrintStatus());

        // Verify another agent cannot claim this already processing job
        assertThrows(IllegalStateException.class, () -> {
            printService.updateJobStatus(job.getId(), JobStatus.PROCESSING, "Agent-02");
        });

        // 5. Print Agent completes job
        mockMvc.perform(post("/api/print-agent/jobs/" + job.getId() + "/completed")
                        .header("X-Agent-Key", shop.getApiKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agentId\":\"Agent-01\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.status").value("COMPLETED"));

        // Verify order print status moved to COMPLETED
        PrintOrder completedOrder = printOrderRepository.findById(order.getId()).orElseThrow();
        assertEquals(PrintStatus.COMPLETED, completedOrder.getPrintStatus());

        // 6. Completed jobs are no longer returned in getQueuedJobs
        List<PrintJobDTO> queuedAfterCompletion = printService.getQueuedJobsByShop(shop.getId());
        boolean existsInQueue = queuedAfterCompletion.stream().anyMatch(j -> j.getJobId().equals(job.getId()));
        assertFalse(existsInQueue, "Completed job must not be in queued list");
    }

    @Test
    @DisplayName("Failure and Retry Lifecycle: QUEUED -> PROCESSING -> FAILED -> QUEUED")
    void testFailedAndRetryLifecycle() throws Exception {
        OrderDTO order = createTestOrder();
        PrintJob job = printJobRepository.findByOrderId(order.getId()).orElseThrow();

        // 1. Mark started
        printService.updateJobStatus(job.getId(), JobStatus.PROCESSING, "Agent-01");

        // 2. Mark failed
        mockMvc.perform(post("/api/print-agent/jobs/" + job.getId() + "/failed")
                        .header("X-Agent-Key", shop.getApiKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agentId\":\"Agent-01\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("FAILED"));

        PrintOrder failedOrder = printOrderRepository.findById(order.getId()).orElseThrow();
        assertEquals(PrintStatus.FAILED, failedOrder.getPrintStatus());

        // 3. Retry job via print agent retry endpoint
        mockMvc.perform(post("/api/print-agent/jobs/" + job.getId() + "/retry")
                        .header("X-Agent-Key", shop.getApiKey()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("QUEUED"));

        // Verify order status reset and job back in queue without duplicate job entity
        long jobCountForOrder = printJobRepository.findAll().stream()
                .filter(j -> j.getOrder().getId().equals(order.getId()))
                .count();
        assertEquals(1, jobCountForOrder, "Retry must not create duplicate PrintJob records");

        PrintOrder requeuedOrder = printOrderRepository.findById(order.getId()).orElseThrow();
        assertEquals(PrintStatus.PENDING, requeuedOrder.getPrintStatus());
    }
}
