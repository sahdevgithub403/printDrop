package com.printalfa.backend;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.printalfa.backend.entity.*;
import com.printalfa.backend.enums.*;
import com.printalfa.backend.repository.*;
import com.printalfa.backend.security.JwtTokenProvider;
import com.printalfa.backend.security.UserPrincipal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.io.File;
import java.io.FileWriter;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@ActiveProfiles("test")
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
public class AdminFileManagementAndSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ShopRepository shopRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private PrintOrderRepository printOrderRepository;

    @Autowired
    private OrderItemRepository orderItemRepository;

    @Autowired
    private PrintJobRepository printJobRepository;

    @Autowired
    private JwtTokenProvider jwtTokenProvider;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private Shop shopA;
    private Shop shopB;

    private String shopAToken;
    private String shopBToken;

    private Document shopADoc1;
    private Document shopADocActive;
    private Document shopBDoc;

    private Path uploadsDir;

    @BeforeEach
    void setUp() throws Exception {
        uploadsDir = Paths.get("./uploads").toAbsolutePath().normalize();
        Files.createDirectories(uploadsDir);

        File f1 = uploadsDir.resolve("test_doc1.pdf").toFile();
        try (FileWriter fw = new FileWriter(f1)) { fw.write("%PDF test doc 1"); }

        File fActive = uploadsDir.resolve("test_doc_active.pdf").toFile();
        try (FileWriter fw = new FileWriter(fActive)) { fw.write("%PDF test active doc"); }

        File fB = uploadsDir.resolve("test_doc_b.pdf").toFile();
        try (FileWriter fw = new FileWriter(fB)) { fw.write("%PDF test doc b"); }

        shopA = shopRepository.save(new Shop("Shop A", "shop-a-files-" + UUID.randomUUID(), "Address A", "1111111111", null));
        shopB = shopRepository.save(new Shop("Shop B", "shop-b-files-" + UUID.randomUUID(), "Address B", "2222222222", null));

        User userA = new User();
        userA.setEmail("adminA_files_" + UUID.randomUUID() + "@shop.com");
        userA.setPassword(passwordEncoder.encode("password"));
        userA.setRole(UserRole.ROLE_SHOP_ADMIN);
        userA.setShop(shopA);
        userA = userRepository.save(userA);

        User userB = new User();
        userB.setEmail("adminB_files_" + UUID.randomUUID() + "@shop.com");
        userB.setPassword(passwordEncoder.encode("password"));
        userB.setRole(UserRole.ROLE_SHOP_ADMIN);
        userB.setShop(shopB);
        userB = userRepository.save(userB);

        UserPrincipal principalA = UserPrincipal.create(userA);
        Authentication authA = new UsernamePasswordAuthenticationToken(principalA, null, principalA.getAuthorities());
        shopAToken = jwtTokenProvider.generateToken(authA);

        UserPrincipal principalB = UserPrincipal.create(userB);
        Authentication authB = new UsernamePasswordAuthenticationToken(principalB, null, principalB.getAuthorities());
        shopBToken = jwtTokenProvider.generateToken(authB);

        // Shop A Document 1 (Completed order - safe to delete)
        shopADoc1 = documentRepository.save(new Document("doc1.pdf", "test_doc1.pdf", "application/pdf", 1024, 1, f1.getAbsolutePath()));

        PrintOrder orderCompleted = new PrintOrder();
        orderCompleted.setOrderNumber("ORD-COMPLETED-" + UUID.randomUUID().toString().substring(0, 6));
        orderCompleted.setShop(shopA);
        orderCompleted.setTotalPrice(new BigDecimal("10.00"));
        orderCompleted.setPaymentMethod(PaymentMethod.ONLINE);
        orderCompleted.setPaymentStatus(PaymentStatus.PAID);
        orderCompleted.setPrintStatus(PrintStatus.COMPLETED);

        OrderItem item1 = new OrderItem();
        item1.setDocument(shopADoc1);
        item1.setPrintType(PrintType.PRINT);
        item1.setColorMode(ColorMode.BW);
        item1.setPaperSize(PaperSize.A4);
        item1.setPrintSide(PrintSide.SINGLE);
        item1.setPageRange("ALL");
        item1.setCopies(1);
        item1.setCalculatedPages(1);
        item1.setUnitPrice(new BigDecimal("10.00"));
        item1.setItemPrice(new BigDecimal("10.00"));
        item1.setPrintStatus(PrintStatus.COMPLETED);
        orderCompleted.addItem(item1);
        printOrderRepository.save(orderCompleted);

        // Shop A Document Active (Pending order - must NOT be deleted)
        shopADocActive = documentRepository.save(new Document("doc_active.pdf", "test_doc_active.pdf", "application/pdf", 2048, 2, fActive.getAbsolutePath()));

        PrintOrder orderPending = new PrintOrder();
        orderPending.setOrderNumber("ORD-PENDING-" + UUID.randomUUID().toString().substring(0, 6));
        orderPending.setShop(shopA);
        orderPending.setTotalPrice(new BigDecimal("20.00"));
        orderPending.setPaymentMethod(PaymentMethod.PAY_AT_SHOP);
        orderPending.setPaymentStatus(PaymentStatus.PENDING);
        orderPending.setPrintStatus(PrintStatus.PENDING);

        OrderItem itemActive = new OrderItem();
        itemActive.setDocument(shopADocActive);
        itemActive.setPrintType(PrintType.PRINT);
        itemActive.setColorMode(ColorMode.BW);
        itemActive.setPaperSize(PaperSize.A4);
        itemActive.setPrintSide(PrintSide.SINGLE);
        itemActive.setPageRange("ALL");
        itemActive.setCopies(1);
        itemActive.setCalculatedPages(2);
        itemActive.setUnitPrice(new BigDecimal("20.00"));
        itemActive.setItemPrice(new BigDecimal("20.00"));
        itemActive.setPrintStatus(PrintStatus.PENDING);
        orderPending.addItem(itemActive);
        printOrderRepository.save(orderPending);

        // Shop B Document
        shopBDoc = documentRepository.save(new Document("doc_b.pdf", "test_doc_b.pdf", "application/pdf", 1024, 1, fB.getAbsolutePath()));

        PrintOrder orderB = new PrintOrder();
        orderB.setOrderNumber("ORD-B-" + UUID.randomUUID().toString().substring(0, 6));
        orderB.setShop(shopB);
        orderB.setTotalPrice(new BigDecimal("15.00"));
        orderB.setPaymentMethod(PaymentMethod.PAY_AT_SHOP);
        orderB.setPaymentStatus(PaymentStatus.PENDING);
        orderB.setPrintStatus(PrintStatus.PENDING);

        OrderItem itemB = new OrderItem();
        itemB.setDocument(shopBDoc);
        itemB.setPrintType(PrintType.PRINT);
        itemB.setColorMode(ColorMode.BW);
        itemB.setPaperSize(PaperSize.A4);
        itemB.setPrintSide(PrintSide.SINGLE);
        itemB.setPageRange("ALL");
        itemB.setCopies(1);
        itemB.setCalculatedPages(1);
        itemB.setUnitPrice(new BigDecimal("15.00"));
        itemB.setItemPrice(new BigDecimal("15.00"));
        itemB.setPrintStatus(PrintStatus.PENDING);
        orderB.addItem(itemB);
        printOrderRepository.save(orderB);
    }

    @Test
    @DisplayName("Admin A can list own shop documents")
    void testAdminCanListOwnDocuments() throws Exception {
        mockMvc.perform(get("/api/admin/documents")
                        .header("Authorization", "Bearer " + shopAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.content.length()").value(2));
    }

    @Test
    @DisplayName("Admin A cannot see Shop B documents (Tenant Isolation)")
    void testShopIsolationInListing() throws Exception {
        mockMvc.perform(get("/api/admin/documents")
                        .header("Authorization", "Bearer " + shopAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.content[*].id").value(org.hamcrest.Matchers.not(org.hamcrest.Matchers.hasItem(shopBDoc.getId().toString()))));
    }

    @Test
    @DisplayName("Admin A can delete own completed document and physical file is deleted")
    void testAdminCanDeleteOwnDocument() throws Exception {
        Path physicalFilePath = uploadsDir.resolve("test_doc1.pdf");
        assertTrue(Files.exists(physicalFilePath), "Physical file should exist before delete");

        mockMvc.perform(delete("/api/admin/documents/" + shopADoc1.getId())
                        .header("Authorization", "Bearer " + shopAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        assertFalse(documentRepository.existsById(shopADoc1.getId()), "Document record should be deleted");
        assertFalse(Files.exists(physicalFilePath), "Physical file should be deleted from disk");
    }

    @Test
    @DisplayName("Admin A cannot delete Shop B document (403 Forbidden)")
    void testAdminCannotDeleteOtherShopDocument() throws Exception {
        mockMvc.perform(delete("/api/admin/documents/" + shopBDoc.getId())
                        .header("Authorization", "Bearer " + shopAToken))
                .andExpect(status().isForbidden());

        assertTrue(documentRepository.existsById(shopBDoc.getId()), "Shop B document should remain intact");
    }

    @Test
    @DisplayName("Active/pending document cannot be deleted (Blocked by safety check)")
    void testActiveDocumentCannotBeDeleted() throws Exception {
        mockMvc.perform(delete("/api/admin/documents/" + shopADocActive.getId())
                        .header("Authorization", "Bearer " + shopAToken))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false));

        assertTrue(documentRepository.existsById(shopADocActive.getId()), "Active document must not be deleted");
    }

    @Test
    @DisplayName("Unauthenticated request to delete document is rejected (401/403)")
    void testUnauthenticatedDeleteRejected() throws Exception {
        mockMvc.perform(delete("/api/admin/documents/" + shopADoc1.getId()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("Bulk delete only deletes owned eligible documents")
    void testBulkDelete() throws Exception {
        Map<String, Object> body = Map.of("documentIds", List.of(shopADoc1.getId(), shopBDoc.getId()));
        ObjectMapper mapper = new ObjectMapper();

        mockMvc.perform(delete("/api/admin/documents/bulk")
                        .header("Authorization", "Bearer " + shopAToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.deletedCount").value(1));

        assertFalse(documentRepository.existsById(shopADoc1.getId()), "Shop A doc should be deleted");
        assertTrue(documentRepository.existsById(shopBDoc.getId()), "Shop B doc should NOT be deleted");
    }

    @Test
    @DisplayName("Delete All only deletes Shop A eligible documents and preserves Shop B")
    void testDeleteAllShopIsolation() throws Exception {
        mockMvc.perform(delete("/api/admin/documents/all")
                        .header("Authorization", "Bearer " + shopAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.deletedCount").value(1))
                .andExpect(jsonPath("$.data.skippedActiveCount").value(1));

        assertFalse(documentRepository.existsById(shopADoc1.getId()), "Completed Shop A doc should be deleted");
        assertTrue(documentRepository.existsById(shopADocActive.getId()), "Active Shop A doc should be skipped");
        assertTrue(documentRepository.existsById(shopBDoc.getId()), "Shop B doc must NOT be touched");
    }
}
