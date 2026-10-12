package com.printalfa.backend;

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
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@ActiveProfiles("test")
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
public class DeleteFlowTest {

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
    private JwtTokenProvider jwtTokenProvider;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private Shop shopA;
    private Shop shopB;
    private String shopAToken;
    private String shopBToken;
    private Path uploadsDir;

    private User createUser(String email, Shop shop) {
        User user = new User();
        user.setEmail(email);
        user.setPassword(passwordEncoder.encode("password123"));
        user.setName("Del Tester");
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

    private PrintOrder createOrder(Shop shop, PaymentStatus payStatus, PrintStatus printStatus) {
        PrintOrder order = new PrintOrder();
        order.setOrderNumber("ORD-DEL-" + UUID.randomUUID().toString().substring(0, 8));
        order.setShop(shop);
        order.setTotalPrice(new BigDecimal("10.00"));
        order.setPaymentMethod(PaymentMethod.PAY_AT_SHOP);
        order.setPaymentStatus(payStatus);
        order.setPrintStatus(printStatus);
        order.setCustomerName("Del Dan");
        return printOrderRepository.save(order);
    }

    private Document createOrphanDoc(String fileName, UUID boundShopId) throws Exception {
        File f = uploadsDir.resolve(fileName).toFile();
        try (FileWriter fw = new FileWriter(f)) { fw.write("%PDF orphan delete test"); }
        Document doc = new Document(fileName, fileName, "application/pdf", 1024L, 1, f.getAbsolutePath());
        doc.setShopId(boundShopId);
        return documentRepository.save(doc);
    }

    @BeforeEach
    void setUp() throws Exception {
        uploadsDir = Paths.get("./uploads").toAbsolutePath().normalize();
        Files.createDirectories(uploadsDir);

        shopA = shopRepository.save(new Shop("Del Shop A", "del-shop-a-" + UUID.randomUUID(), "Addr A", "1111111111", null));
        shopB = shopRepository.save(new Shop("Del Shop B", "del-shop-b-" + UUID.randomUUID(), "Addr B", "2222222222", null));
        shopAToken = tokenFor(createUser("delA_" + UUID.randomUUID() + "@shop.com", shopA));
        shopBToken = tokenFor(createUser("delB_" + UUID.randomUUID() + "@shop.com", shopB));
    }

    @Test
    @DisplayName("Orphan document bound to own shop can be deleted (200)")
    void orphanBoundToOwnShopDeletable() throws Exception {
        Document orphan = createOrphanDoc("orphan_own_" + UUID.randomUUID() + ".pdf", shopA.getId());
        Path physical = uploadsDir.resolve(orphan.getStoredFileName());
        assertTrue(Files.exists(physical));

        mockMvc.perform(delete("/api/admin/documents/" + orphan.getId())
                        .header("Authorization", "Bearer " + shopAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        assertFalse(documentRepository.existsById(orphan.getId()));
        assertFalse(Files.exists(physical));
    }

    @Test
    @DisplayName("Orphan document without upload shop binding is denied (403)")
    void orphanWithoutBindingDenied() throws Exception {
        Document orphan = createOrphanDoc("orphan_noshop_" + UUID.randomUUID() + ".pdf", null);

        mockMvc.perform(delete("/api/admin/documents/" + orphan.getId())
                        .header("Authorization", "Bearer " + shopAToken))
                .andExpect(status().isForbidden());

        assertTrue(documentRepository.existsById(orphan.getId()));
    }

    @Test
    @DisplayName("Shop B cannot delete Shop A orphan document (403)")
    void crossShopOrphanDenied() throws Exception {
        Document orphan = createOrphanDoc("orphan_cross_" + UUID.randomUUID() + ".pdf", shopA.getId());

        mockMvc.perform(delete("/api/admin/documents/" + orphan.getId())
                        .header("Authorization", "Bearer " + shopBToken))
                .andExpect(status().isForbidden());

        assertTrue(documentRepository.existsById(orphan.getId()));
    }

    @Test
    @DisplayName("Deleting nonexistent document is denied (403, existing convention)")
    void nonexistentDocumentDenied() throws Exception {
        mockMvc.perform(delete("/api/admin/documents/" + UUID.randomUUID())
                        .header("Authorization", "Bearer " + shopAToken))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("Completed order requires confirm=true (409 without, 200 with)")
    void completedOrderConfirmContract() throws Exception {
        PrintOrder order = createOrder(shopA, PaymentStatus.PENDING, PrintStatus.COMPLETED);

        mockMvc.perform(delete("/api/admin/orders/" + order.getId())
                        .header("Authorization", "Bearer " + shopAToken))
                .andExpect(status().isConflict());
        assertTrue(printOrderRepository.existsById(order.getId()));

        mockMvc.perform(delete("/api/admin/orders/" + order.getId())
                        .header("Authorization", "Bearer " + shopAToken)
                        .param("confirm", "true"))
                .andExpect(status().isOk());
        assertFalse(printOrderRepository.existsById(order.getId()));
    }

    @Test
    @DisplayName("PAID order cannot be deleted (409)")
    void paidOrderCannotBeDeleted() throws Exception {
        PrintOrder order = createOrder(shopA, PaymentStatus.PAID, PrintStatus.COMPLETED);

        mockMvc.perform(delete("/api/admin/orders/" + order.getId())
                        .header("Authorization", "Bearer " + shopAToken)
                        .param("confirm", "true"))
                .andExpect(status().isConflict());
        assertTrue(printOrderRepository.existsById(order.getId()));
    }

    @Test
    @DisplayName("Deleting nonexistent order returns 400 (project convention)")
    void nonexistentOrderBadRequest() throws Exception {
        mockMvc.perform(delete("/api/admin/orders/" + UUID.randomUUID())
                        .header("Authorization", "Bearer " + shopAToken))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("Unauthenticated order delete is rejected (401)")
    void unauthenticatedOrderDeleteRejected() throws Exception {
        PrintOrder order = createOrder(shopA, PaymentStatus.PENDING, PrintStatus.PENDING);

        mockMvc.perform(delete("/api/admin/orders/" + order.getId()))
                .andExpect(status().isUnauthorized());
        assertTrue(printOrderRepository.existsById(order.getId()));
    }

    @Test
    @DisplayName("Invalid JWT on order delete is rejected (401)")
    void invalidJwtOrderDeleteRejected() throws Exception {
        PrintOrder order = createOrder(shopA, PaymentStatus.PENDING, PrintStatus.PENDING);

        mockMvc.perform(delete("/api/admin/orders/" + order.getId())
                        .header("Authorization", "Bearer invalid.token.here"))
                .andExpect(status().isUnauthorized());
        assertTrue(printOrderRepository.existsById(order.getId()));
    }

    @Test
    @DisplayName("Shop B cannot delete Shop A order (403)")
    void crossShopOrderDeleteDenied() throws Exception {
        PrintOrder order = createOrder(shopA, PaymentStatus.PENDING, PrintStatus.PENDING);

        mockMvc.perform(delete("/api/admin/orders/" + order.getId())
                        .header("Authorization", "Bearer " + shopBToken))
                .andExpect(status().isForbidden());
        assertTrue(printOrderRepository.existsById(order.getId()));
    }
}
