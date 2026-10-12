package com.printalfa.backend;

import com.printalfa.backend.dto.CreateOrderItemRequest;
import com.printalfa.backend.dto.CreateOrderRequest;
import com.printalfa.backend.dto.OrderDTO;
import com.printalfa.backend.entity.Document;
import com.printalfa.backend.entity.Shop;
import com.printalfa.backend.entity.ShopPricing;
import com.printalfa.backend.enums.ColorMode;
import com.printalfa.backend.enums.PaperSize;
import com.printalfa.backend.enums.PaymentMethod;
import com.printalfa.backend.enums.PrintSide;
import com.printalfa.backend.enums.PrintType;
import com.printalfa.backend.repository.DocumentRepository;
import com.printalfa.backend.repository.PrintOrderRepository;
import com.printalfa.backend.repository.ShopPricingRepository;
import com.printalfa.backend.repository.ShopRepository;
import com.printalfa.backend.service.OrderService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.boot.test.context.SpringBootTest;

import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;

@ActiveProfiles("test")
@SpringBootTest
public class OrderNumberGenerationTest {

    @Autowired
    private OrderService orderService;

    @Autowired
    private ShopRepository shopRepository;

    @Autowired
    private ShopPricingRepository shopPricingRepository;

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private PrintOrderRepository printOrderRepository;

    private Shop shop;
    private Document document;

    @BeforeEach
    void setUp() {
        shop = shopRepository.save(new Shop("Test Order Shop", "shop-ord-" + UUID.randomUUID(), "123 Main St", "9999999999", null));
        
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

        document = documentRepository.save(new Document("test_doc.pdf", "test_doc_" + UUID.randomUUID() + ".pdf", "application/pdf", 1024, 2, "uploads/test_doc.pdf"));
    }

    @Test
    @DisplayName("Single and repeated order creation produces unique, well-formatted order numbers")
    void testOrderNumberFormatAndUniqueness() {
        Set<String> generatedNumbers = new HashSet<>();
        int count = 50;

        for (int i = 0; i < count; i++) {
            CreateOrderRequest req = new CreateOrderRequest();
            req.setShopId(shop.getId());
            req.setPaymentMethod(PaymentMethod.PAY_AT_SHOP);
            req.setCustomerName("Customer " + i);
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

            OrderDTO orderDTO = orderService.createOrder(req);

            assertNotNull(orderDTO);
            assertNotNull(orderDTO.getOrderNumber());
            assertTrue(orderDTO.getOrderNumber().startsWith("PR-"), "Order number should start with PR-");
            assertTrue(orderDTO.getOrderNumber().length() >= 6, "Order number should be reasonably sized");

            boolean isUnique = generatedNumbers.add(orderDTO.getOrderNumber());
            assertTrue(isUnique, "Duplicate order number detected: " + orderDTO.getOrderNumber());

            // Verify existence in database
            assertTrue(printOrderRepository.existsByOrderNumber(orderDTO.getOrderNumber()));
        }

        assertEquals(count, generatedNumbers.size(), "All generated order numbers must be unique");
    }

    @Test
    @DisplayName("Concurrent order creations produce unique order numbers without duplicate constraint failure")
    void testConcurrentOrderNumberUniqueness() throws Exception {
        int threads = 20;
        ExecutorService executor = Executors.newFixedThreadPool(threads);
        List<Callable<String>> tasks = new ArrayList<>();

        for (int i = 0; i < threads; i++) {
            final int index = i;
            tasks.add(() -> {
                CreateOrderRequest req = new CreateOrderRequest();
                req.setShopId(shop.getId());
                req.setPaymentMethod(PaymentMethod.PAY_AT_SHOP);
                req.setCustomerName("Concurrent Customer " + index);
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

                OrderDTO orderDTO = orderService.createOrder(req);
                return orderDTO.getOrderNumber();
            });
        }

        List<Future<String>> futures = executor.invokeAll(tasks);
        Set<String> orderNumbers = new HashSet<>();

        for (Future<String> future : futures) {
            String orderNum = future.get(10, TimeUnit.SECONDS);
            assertNotNull(orderNum);
            boolean added = orderNumbers.add(orderNum);
            assertTrue(added, "Duplicate order number found in concurrent execution: " + orderNum);
        }

        executor.shutdown();
        assertEquals(threads, orderNumbers.size(), "All concurrent order numbers must be unique");
    }
}
