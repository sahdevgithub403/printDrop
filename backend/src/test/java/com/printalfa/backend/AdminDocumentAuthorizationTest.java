package com.printalfa.backend;

import com.printalfa.backend.entity.Document;
import com.printalfa.backend.entity.OrderItem;
import com.printalfa.backend.entity.PrintOrder;
import com.printalfa.backend.entity.Shop;
import com.printalfa.backend.enums.*;
import com.printalfa.backend.repository.DocumentRepository;
import com.printalfa.backend.repository.OrderItemRepository;
import com.printalfa.backend.repository.PrintOrderRepository;
import com.printalfa.backend.repository.ShopRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ActiveProfiles("test")
@SpringBootTest
@Transactional
public class AdminDocumentAuthorizationTest {

    @Autowired
    private ShopRepository shopRepository;

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private PrintOrderRepository printOrderRepository;

    @Autowired
    private OrderItemRepository orderItemRepository;

    private Shop shopA;
    private Shop shopB;

    private Document singleFileDoc;
    private Document multiFileDocPrimary;
    private Document multiFileDocSecondary;
    private Document multiFileDocThird;
    private Document shopBDoc;
    private Document unattachedDoc;

    @BeforeEach
    void setUp() {
        shopA = shopRepository.save(new Shop("Shop A", "shop-a-" + UUID.randomUUID(), "Address A", "1111111111", null));
        shopB = shopRepository.save(new Shop("Shop B", "shop-b-" + UUID.randomUUID(), "Address B", "2222222222", null));

        // Create Documents
        singleFileDoc = documentRepository.save(new Document("single.pdf", "stored_single.pdf", "application/pdf", 1024, 1, "uploads/stored_single.pdf"));
        multiFileDocPrimary = documentRepository.save(new Document("primary.pdf", "stored_primary.pdf", "application/pdf", 2048, 2, "uploads/stored_primary.pdf"));
        multiFileDocSecondary = documentRepository.save(new Document("secondary.pdf", "stored_secondary.pdf", "application/pdf", 4096, 4, "uploads/stored_secondary.pdf"));
        multiFileDocThird = documentRepository.save(new Document("third.png", "stored_third.png", "image/png", 512, 1, "uploads/stored_third.png"));
        shopBDoc = documentRepository.save(new Document("shopB.pdf", "stored_shopB.pdf", "application/pdf", 1024, 1, "uploads/stored_shopB.pdf"));
        unattachedDoc = documentRepository.save(new Document("unattached.pdf", "stored_unattached.pdf", "application/pdf", 1024, 1, "uploads/stored_unattached.pdf"));

        // 1. Single-file order for Shop A (Legacy on PrintOrder and OrderItem)
        PrintOrder singleOrder = new PrintOrder();
        singleOrder.setOrderNumber("ORD-SINGLE-" + UUID.randomUUID().toString().substring(0, 8));
        singleOrder.setShop(shopA);
        singleOrder.setDocument(singleFileDoc);
        singleOrder.setTotalPrice(new BigDecimal("10.00"));
        singleOrder.setPaymentMethod(PaymentMethod.PAY_AT_SHOP);
        singleOrder.setPaymentStatus(PaymentStatus.PENDING);
        singleOrder.setPrintStatus(PrintStatus.PENDING);
        singleOrder = printOrderRepository.save(singleOrder);

        OrderItem singleItem = new OrderItem();
        singleItem.setOrder(singleOrder);
        singleItem.setDocument(singleFileDoc);
        singleItem.setPrintType(PrintType.PRINT);
        singleItem.setColorMode(ColorMode.BW);
        singleItem.setPaperSize(PaperSize.A4);
        singleItem.setPrintSide(PrintSide.SINGLE);
        singleItem.setPageRange("ALL");
        singleItem.setCopies(1);
        singleItem.setCalculatedPages(1);
        singleItem.setUnitPrice(new BigDecimal("10.00"));
        singleItem.setItemPrice(new BigDecimal("10.00"));
        singleItem.setPrintStatus(PrintStatus.PENDING);
        orderItemRepository.save(singleItem);

        // 2. Multi-file order for Shop A (3 files: primary, secondary, third)
        PrintOrder multiOrder = new PrintOrder();
        multiOrder.setOrderNumber("ORD-MULTI-" + UUID.randomUUID().toString().substring(0, 8));
        multiOrder.setShop(shopA);
        multiOrder.setDocument(multiFileDocPrimary); // Legacy pointer only on first doc
        multiOrder.setTotalPrice(new BigDecimal("30.00"));
        multiOrder.setPaymentMethod(PaymentMethod.PAY_AT_SHOP);
        multiOrder.setPaymentStatus(PaymentStatus.PENDING);
        multiOrder.setPrintStatus(PrintStatus.PENDING);
        multiOrder = printOrderRepository.save(multiOrder);

        // Item 1
        OrderItem item1 = new OrderItem();
        item1.setOrder(multiOrder);
        item1.setDocument(multiFileDocPrimary);
        item1.setPrintType(PrintType.PRINT);
        item1.setColorMode(ColorMode.BW);
        item1.setPaperSize(PaperSize.A4);
        item1.setPrintSide(PrintSide.SINGLE);
        item1.setPageRange("ALL");
        item1.setCopies(1);
        item1.setCalculatedPages(2);
        item1.setUnitPrice(new BigDecimal("5.00"));
        item1.setItemPrice(new BigDecimal("10.00"));
        item1.setPrintStatus(PrintStatus.PENDING);
        multiOrder.addItem(item1);

        // Item 2 (Secondary file)
        OrderItem item2 = new OrderItem();
        item2.setOrder(multiOrder);
        item2.setDocument(multiFileDocSecondary);
        item2.setPrintType(PrintType.PRINT);
        item2.setColorMode(ColorMode.COLOR);
        item2.setPaperSize(PaperSize.A4);
        item2.setPrintSide(PrintSide.SINGLE);
        item2.setPageRange("ALL");
        item2.setCopies(1);
        item2.setCalculatedPages(4);
        item2.setUnitPrice(new BigDecimal("10.00"));
        item2.setItemPrice(new BigDecimal("40.00"));
        item2.setPrintStatus(PrintStatus.PENDING);
        multiOrder.addItem(item2);

        // Item 3 (Third file)
        OrderItem item3 = new OrderItem();
        item3.setOrder(multiOrder);
        item3.setDocument(multiFileDocThird);
        item3.setPrintType(PrintType.XEROX);
        item3.setColorMode(ColorMode.BW);
        item3.setPaperSize(PaperSize.A4);
        item3.setPrintSide(PrintSide.SINGLE);
        item3.setPageRange("ALL");
        item3.setCopies(1);
        item3.setCalculatedPages(1);
        item3.setUnitPrice(new BigDecimal("2.00"));
        item3.setItemPrice(new BigDecimal("2.00"));
        item3.setPrintStatus(PrintStatus.PENDING);
        multiOrder.addItem(item3);

        printOrderRepository.save(multiOrder);

        // 3. Order for Shop B
        PrintOrder shopBOrder = new PrintOrder();
        shopBOrder.setOrderNumber("ORD-B-" + UUID.randomUUID().toString().substring(0, 8));
        shopBOrder.setShop(shopB);
        shopBOrder.setDocument(shopBDoc);
        shopBOrder.setTotalPrice(new BigDecimal("15.00"));
        shopBOrder.setPaymentMethod(PaymentMethod.PAY_AT_SHOP);
        shopBOrder.setPaymentStatus(PaymentStatus.PENDING);
        shopBOrder.setPrintStatus(PrintStatus.PENDING);
        shopBOrder = printOrderRepository.save(shopBOrder);

        OrderItem shopBItem = new OrderItem();
        shopBItem.setOrder(shopBOrder);
        shopBItem.setDocument(shopBDoc);
        shopBItem.setPrintType(PrintType.PRINT);
        shopBItem.setColorMode(ColorMode.BW);
        shopBItem.setPaperSize(PaperSize.A4);
        shopBItem.setPrintSide(PrintSide.SINGLE);
        shopBItem.setPageRange("ALL");
        shopBItem.setCopies(1);
        shopBItem.setCalculatedPages(1);
        shopBItem.setUnitPrice(new BigDecimal("15.00"));
        shopBItem.setItemPrice(new BigDecimal("15.00"));
        shopBItem.setPrintStatus(PrintStatus.PENDING);
        shopBOrder.addItem(shopBItem);
        printOrderRepository.save(shopBOrder);
    }

    @Test
    @DisplayName("Shop A Admin can access single-file order document")
    void testSingleFileOrderDocumentAccess() {
        boolean access = printOrderRepository.existsByShopIdAndDocumentId(shopA.getId(), singleFileDoc.getId());
        assertTrue(access, "Shop A Admin should have access to single-file order document");
    }

    @Test
    @DisplayName("Shop A Admin can access primary document of multi-file order")
    void testMultiFilePrimaryDocumentAccess() {
        boolean access = printOrderRepository.existsByShopIdAndDocumentId(shopA.getId(), multiFileDocPrimary.getId());
        assertTrue(access, "Shop A Admin should have access to primary document in multi-file order");
    }

    @Test
    @DisplayName("Shop A Admin can access secondary document of multi-file order")
    void testMultiFileSecondaryDocumentAccess() {
        boolean access = printOrderRepository.existsByShopIdAndDocumentId(shopA.getId(), multiFileDocSecondary.getId());
        assertTrue(access, "Shop A Admin should have access to secondary document in multi-file order");
    }

    @Test
    @DisplayName("Shop A Admin can access third document of multi-file order")
    void testMultiFileThirdDocumentAccess() {
        boolean access = printOrderRepository.existsByShopIdAndDocumentId(shopA.getId(), multiFileDocThird.getId());
        assertTrue(access, "Shop A Admin should have access to third document in multi-file order");
    }

    @Test
    @DisplayName("Shop A Admin CANNOT access Shop B document (Cross-shop isolation)")
    void testCrossShopIsolation() {
        boolean access = printOrderRepository.existsByShopIdAndDocumentId(shopA.getId(), shopBDoc.getId());
        assertFalse(access, "Shop A Admin must NOT have access to Shop B document");
    }

    @Test
    @DisplayName("Shop B Admin can access Shop B document")
    void testShopBValidAccess() {
        boolean access = printOrderRepository.existsByShopIdAndDocumentId(shopB.getId(), shopBDoc.getId());
        assertTrue(access, "Shop B Admin should have access to its own order document");
    }

    @Test
    @DisplayName("Shop B Admin CANNOT access Shop A secondary multi-file document")
    void testShopBCannotAccessShopASecondaryDoc() {
        boolean access = printOrderRepository.existsByShopIdAndDocumentId(shopB.getId(), multiFileDocSecondary.getId());
        assertFalse(access, "Shop B Admin must NOT have access to Shop A secondary document");
    }

    @Test
    @DisplayName("Shop Admin CANNOT access unattached orphaned document")
    void testUnattachedDocumentAccess() {
        boolean accessA = printOrderRepository.existsByShopIdAndDocumentId(shopA.getId(), unattachedDoc.getId());
        assertFalse(accessA, "Shop A Admin must NOT have access to unattached document");

        boolean accessB = printOrderRepository.existsByShopIdAndDocumentId(shopB.getId(), unattachedDoc.getId());
        assertFalse(accessB, "Shop B Admin must NOT have access to unattached document");
    }
}
