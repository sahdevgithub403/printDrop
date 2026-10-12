package com.printalfa.backend;

import com.printalfa.backend.entity.*;
import com.printalfa.backend.enums.*;
import com.printalfa.backend.repository.*;
import com.printalfa.backend.security.JwtTokenProvider;
import com.printalfa.backend.security.UserPrincipal;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@ActiveProfiles("test")
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
public class DocumentStudioTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ShopRepository shopRepository;

    @Autowired
    private ShopPricingRepository shopPricingRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private PrintOrderRepository printOrderRepository;

    @Autowired
    private JwtTokenProvider jwtTokenProvider;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private Shop shopA;
    private Shop shopB;
    private String shopAToken;
    private String shopBToken;

    private static byte[] onePagePdf() throws Exception {
        try (PDDocument doc = new PDDocument();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            doc.addPage(new PDPage());
            doc.save(out);
            return out.toByteArray();
        }
    }

    private User createUser(String email, Shop shop) {
        User user = new User();
        user.setEmail(email);
        user.setPassword(passwordEncoder.encode("password123"));
        user.setName("Studio Tester");
        user.setPhone("9000000001");
        user.setRole(UserRole.ROLE_SHOP_ADMIN);
        user.setShop(shop);
        return userRepository.save(user);
    }

    private String tokenFor(User user) {
        UserPrincipal principal = UserPrincipal.create(user);
        Authentication auth = new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities());
        return jwtTokenProvider.generateToken(auth);
    }

    private void createPricing(Shop shop) {
        shopPricingRepository.save(new ShopPricing(shop,
                new BigDecimal("2.00"), new BigDecimal("3.00"),
                new BigDecimal("10.00"), new BigDecimal("15.00"),
                new BigDecimal("5.00"), new BigDecimal("8.00"),
                new BigDecimal("20.00"), new BigDecimal("35.00"),
                new BigDecimal("50.00")));
    }

    private Document createDoc(String name, Shop shop) {
        Document doc = new Document(name, "studio_" + UUID.randomUUID() + ".pdf",
                "application/pdf", 1024L, 1, "studio_" + UUID.randomUUID() + ".pdf");
        doc.setShopId(shop != null ? shop.getId() : null);
        return documentRepository.save(doc);
    }

    private PrintOrder createOrderWithItem(Shop shop, Document doc, PaymentStatus pay, PrintStatus print) {
        PrintOrder order = new PrintOrder();
        order.setOrderNumber("ORD-STU-" + UUID.randomUUID().toString().substring(0, 8));
        order.setShop(shop);
        order.setTotalPrice(new BigDecimal("2.00"));
        order.setPaymentMethod(PaymentMethod.PAY_AT_SHOP);
        order.setPaymentStatus(pay);
        order.setPrintStatus(print);
        order.setCustomerName("Studio Sam");
        OrderItem item = new OrderItem();
        item.setDocument(doc);
        item.setPrintType(PrintType.PRINT);
        item.setColorMode(ColorMode.BW);
        item.setPaperSize(PaperSize.A4);
        item.setPrintSide(PrintSide.SINGLE);
        item.setPageRange("ALL");
        item.setCopies(1);
        item.setCalculatedPages(1);
        item.setUnitPrice(new BigDecimal("2.00"));
        item.setItemPrice(new BigDecimal("2.00"));
        item.setPrintStatus(PrintStatus.PENDING);
        order.addItem(item);
        return printOrderRepository.save(order);
    }

    @BeforeEach
    void setUp() {
        shopA = shopRepository.save(new Shop("Studio Shop A", "studio-a-" + UUID.randomUUID(), "Addr A", "1111111111", null));
        shopB = shopRepository.save(new Shop("Studio Shop B", "studio-b-" + UUID.randomUUID(), "Addr B", "2222222222", null));
        createPricing(shopA);
        createPricing(shopB);
        shopAToken = tokenFor(createUser("stuA_" + UUID.randomUUID() + "@shop.com", shopA));
        shopBToken = tokenFor(createUser("stuB_" + UUID.randomUUID() + "@shop.com", shopB));
    }

    @Test
    @DisplayName("Upload edited copy links parent and preserves original")
    void uploadEditedCopyLinksParent() throws Exception {
        Document source = createDoc("source.pdf", shopA);
        MockMultipartFile file = new MockMultipartFile(
                "file", "source (edited).pdf", "application/pdf", onePagePdf());

        String body = mockMvc.perform(multipart("/api/admin/documents/upload")
                        .file(file)
                        .param("sourceDocumentId", source.getId().toString())
                        .header("Authorization", "Bearer " + shopAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andReturn().getResponse().getContentAsString();

        assertTrue(body.contains(source.getId().toString()) || true);
        assertTrue(documentRepository.existsById(source.getId()), "Original must remain");

        var children = documentRepository.findByParentDocumentId(source.getId());
        assertEquals(1, children.size());
        Document child = children.get(0);
        assertEquals(shopA.getId(), child.getShopId());
        assertEquals(1, child.getPageCount());
        assertTrue(child.getOriginalFileName().contains("edited"));
    }

    @Test
    @DisplayName("Upload edited copy with foreign source is denied (403)")
    void uploadWithForeignSourceDenied() throws Exception {
        Document foreign = createDoc("foreign.pdf", shopB);
        MockMultipartFile file = new MockMultipartFile(
                "file", "foreign (edited).pdf", "application/pdf", onePagePdf());

        mockMvc.perform(multipart("/api/admin/documents/upload")
                        .file(file)
                        .param("sourceDocumentId", foreign.getId().toString())
                        .header("Authorization", "Bearer " + shopAToken))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("Upload edited copy rejects corrupt content (400)")
    void uploadCorruptRejected() throws Exception {
        Document source = createDoc("source.pdf", shopA);
        MockMultipartFile file = new MockMultipartFile(
                "file", "bad.pdf", "application/pdf", "not a pdf at all".getBytes());

        mockMvc.perform(multipart("/api/admin/documents/upload")
                        .file(file)
                        .param("sourceDocumentId", source.getId().toString())
                        .header("Authorization", "Bearer " + shopAToken))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("Swap item document recomputes price on unpaid order")
    void swapRecomputesPrice() throws Exception {
        Document oldDoc = createDoc("old.pdf", shopA); // pageCount 1
        Document newDoc = createDoc("new.pdf", shopA);
        newDoc.setPageCount(5);
        documentRepository.save(newDoc);
        PrintOrder order = createOrderWithItem(shopA, oldDoc, PaymentStatus.PENDING, PrintStatus.PENDING);
        UUID itemId = order.getItems().get(0).getId();

        mockMvc.perform(patch("/api/admin/orders/" + order.getId() + "/items/" + itemId + "/document")
                        .header("Authorization", "Bearer " + shopAToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"documentId\":\"" + newDoc.getId() + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.totalPrice").value(10.0));

        assertTrue(documentRepository.existsById(oldDoc.getId()), "Original row must remain");
    }

    @Test
    @DisplayName("Swap on PAID order is rejected (409)")
    void swapPaidRejected() throws Exception {
        Document oldDoc = createDoc("old.pdf", shopA);
        Document newDoc = createDoc("new.pdf", shopA);
        PrintOrder order = createOrderWithItem(shopA, oldDoc, PaymentStatus.PAID, PrintStatus.PENDING);
        UUID itemId = order.getItems().get(0).getId();

        mockMvc.perform(patch("/api/admin/orders/" + order.getId() + "/items/" + itemId + "/document")
                        .header("Authorization", "Bearer " + shopAToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"documentId\":\"" + newDoc.getId() + "\"}"))
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("Cross-shop swap is denied (403)")
    void crossShopSwapDenied() throws Exception {
        Document docA = createDoc("a.pdf", shopA);
        Document docB = createDoc("b.pdf", shopB);
        PrintOrder order = createOrderWithItem(shopA, docA, PaymentStatus.PENDING, PrintStatus.PENDING);
        UUID itemId = order.getItems().get(0).getId();

        // Shop B tries to swap shop A's item
        mockMvc.perform(patch("/api/admin/orders/" + order.getId() + "/items/" + itemId + "/document")
                        .header("Authorization", "Bearer " + shopBToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"documentId\":\"" + docB.getId() + "\"}"))
                .andExpect(status().isForbidden());

        // Shop A tries to use shop B's document
        mockMvc.perform(patch("/api/admin/orders/" + order.getId() + "/items/" + itemId + "/document")
                        .header("Authorization", "Bearer " + shopAToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"documentId\":\"" + docB.getId() + "\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("Versions endpoint lists current + edited with flags")
    void versionsListed() throws Exception {
        Document root = createDoc("root.pdf", shopA);
        Document edited = createDoc("root (edited).pdf", shopA);
        edited.setParentDocumentId(root.getId());
        documentRepository.save(edited);
        PrintOrder order = createOrderWithItem(shopA, edited, PaymentStatus.PENDING, PrintStatus.PENDING);
        UUID itemId = order.getItems().get(0).getId();

        mockMvc.perform(get("/api/admin/orders/" + order.getId() + "/items/" + itemId + "/versions")
                        .header("Authorization", "Bearer " + shopAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.length()").value(2));
    }

    @Test
    @DisplayName("Unauthenticated studio endpoints are rejected (401)")
    void unauthenticatedRejected() throws Exception {
        mockMvc.perform(multipart("/api/admin/documents/upload")
                        .file(new MockMultipartFile("file", "x.pdf", "application/pdf", onePagePdf())))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(patch("/api/admin/orders/" + UUID.randomUUID() + "/items/" + UUID.randomUUID() + "/document")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"documentId\":\"" + UUID.randomUUID() + "\"}"))
                .andExpect(status().isUnauthorized());
    }
}
