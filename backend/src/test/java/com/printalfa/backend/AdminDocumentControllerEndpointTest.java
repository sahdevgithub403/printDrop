package com.printalfa.backend;

import com.printalfa.backend.entity.Document;
import com.printalfa.backend.entity.OrderItem;
import com.printalfa.backend.entity.PrintOrder;
import com.printalfa.backend.entity.Shop;
import com.printalfa.backend.entity.User;
import com.printalfa.backend.enums.*;
import com.printalfa.backend.repository.DocumentRepository;
import com.printalfa.backend.repository.OrderItemRepository;
import com.printalfa.backend.repository.PrintOrderRepository;
import com.printalfa.backend.repository.ShopRepository;
import com.printalfa.backend.repository.UserRepository;
import com.printalfa.backend.security.JwtTokenProvider;
import com.printalfa.backend.security.UserPrincipal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.io.File;
import java.io.FileWriter;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ActiveProfiles("test")
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
public class AdminDocumentControllerEndpointTest {

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
    private JwtTokenProvider jwtTokenProvider;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private Shop shopA;
    private Shop shopB;

    private String shopAToken;
    private String shopBToken;

    private Document primaryDoc;
    private Document secondaryDoc;
    private Document shopBDoc;

    @BeforeEach
    void setUp() throws Exception {
        // Create upload dir and test physical files
        Path uploadsDir = Paths.get("./uploads").toAbsolutePath().normalize();
        Files.createDirectories(uploadsDir);

        File f1 = uploadsDir.resolve("test_primary.pdf").toFile();
        try (FileWriter fw = new FileWriter(f1)) { fw.write("%PDF-1.4 test primary content"); }

        File f2 = uploadsDir.resolve("test_secondary.pdf").toFile();
        try (FileWriter fw = new FileWriter(f2)) { fw.write("%PDF-1.4 test secondary content"); }

        File f3 = uploadsDir.resolve("test_shopb.pdf").toFile();
        try (FileWriter fw = new FileWriter(f3)) { fw.write("%PDF-1.4 test shop b content"); }

        shopA = shopRepository.save(new Shop("Shop A", "shop-a-ctrl-" + UUID.randomUUID(), "Address A", "1111111111", null));
        shopB = shopRepository.save(new Shop("Shop B", "shop-b-ctrl-" + UUID.randomUUID(), "Address B", "2222222222", null));

        User userA = new User();
        userA.setEmail("adminA_" + UUID.randomUUID() + "@shop.com");
        userA.setPassword(passwordEncoder.encode("password"));
        userA.setRole(UserRole.ROLE_SHOP_ADMIN);
        userA.setShop(shopA);
        userA = userRepository.save(userA);

        User userB = new User();
        userB.setEmail("adminB_" + UUID.randomUUID() + "@shop.com");
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

        primaryDoc = documentRepository.save(new Document("Contract_Page1.pdf", "test_primary.pdf", "application/pdf", 1024, 1, f1.getAbsolutePath()));
        secondaryDoc = documentRepository.save(new Document("Appendix_Page2.pdf", "test_secondary.pdf", "application/pdf", 2048, 1, f2.getAbsolutePath()));
        shopBDoc = documentRepository.save(new Document("Confidential_ShopB.pdf", "test_shopb.pdf", "application/pdf", 1024, 1, f3.getAbsolutePath()));

        // Create multi-file order for Shop A
        PrintOrder orderA = new PrintOrder();
        orderA.setOrderNumber("ORD-MULTI-CTRL-" + UUID.randomUUID().toString().substring(0, 8));
        orderA.setShop(shopA);
        orderA.setDocument(primaryDoc);
        orderA.setTotalPrice(new BigDecimal("20.00"));
        orderA.setPaymentMethod(PaymentMethod.PAY_AT_SHOP);
        orderA.setPaymentStatus(PaymentStatus.PENDING);
        orderA.setPrintStatus(PrintStatus.PENDING);
        orderA = printOrderRepository.save(orderA);

        OrderItem item1 = new OrderItem();
        item1.setOrder(orderA);
        item1.setDocument(primaryDoc);
        item1.setPrintType(PrintType.PRINT);
        item1.setColorMode(ColorMode.BW);
        item1.setPaperSize(PaperSize.A4);
        item1.setPrintSide(PrintSide.SINGLE);
        item1.setPageRange("ALL");
        item1.setCopies(1);
        item1.setCalculatedPages(1);
        item1.setUnitPrice(new BigDecimal("10.00"));
        item1.setItemPrice(new BigDecimal("10.00"));
        item1.setPrintStatus(PrintStatus.PENDING);
        orderA.addItem(item1);

        OrderItem item2 = new OrderItem();
        item2.setOrder(orderA);
        item2.setDocument(secondaryDoc);
        item2.setPrintType(PrintType.PRINT);
        item2.setColorMode(ColorMode.BW);
        item2.setPaperSize(PaperSize.A4);
        item2.setPrintSide(PrintSide.SINGLE);
        item2.setPageRange("ALL");
        item2.setCopies(1);
        item2.setCalculatedPages(1);
        item2.setUnitPrice(new BigDecimal("10.00"));
        item2.setItemPrice(new BigDecimal("10.00"));
        item2.setPrintStatus(PrintStatus.PENDING);
        orderA.addItem(item2);

        printOrderRepository.save(orderA);

        // Create order for Shop B
        PrintOrder orderB = new PrintOrder();
        orderB.setOrderNumber("ORD-B-CTRL-" + UUID.randomUUID().toString().substring(0, 8));
        orderB.setShop(shopB);
        orderB.setDocument(shopBDoc);
        orderB.setTotalPrice(new BigDecimal("10.00"));
        orderB.setPaymentMethod(PaymentMethod.PAY_AT_SHOP);
        orderB.setPaymentStatus(PaymentStatus.PENDING);
        orderB.setPrintStatus(PrintStatus.PENDING);
        orderB = printOrderRepository.save(orderB);

        OrderItem itemB = new OrderItem();
        itemB.setOrder(orderB);
        itemB.setDocument(shopBDoc);
        itemB.setPrintType(PrintType.PRINT);
        itemB.setColorMode(ColorMode.BW);
        itemB.setPaperSize(PaperSize.A4);
        itemB.setPrintSide(PrintSide.SINGLE);
        itemB.setPageRange("ALL");
        itemB.setCopies(1);
        itemB.setCalculatedPages(1);
        itemB.setUnitPrice(new BigDecimal("10.00"));
        itemB.setItemPrice(new BigDecimal("10.00"));
        itemB.setPrintStatus(PrintStatus.PENDING);
        orderB.addItem(itemB);

        printOrderRepository.save(orderB);
    }

    @Test
    @DisplayName("Admin A downloads primary document successfully (200 OK)")
    void testDownloadPrimaryDocument() throws Exception {
        mockMvc.perform(get("/api/admin/documents/" + primaryDoc.getId() + "/download")
                        .header("Authorization", "Bearer " + shopAToken))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", "attachment; filename=\"Contract_Page1.pdf\"; filename*=UTF-8''Contract_Page1.pdf"));
    }

    @Test
    @DisplayName("Admin A downloads SECONDARY document in multi-file order successfully (200 OK)")
    void testDownloadSecondaryDocument() throws Exception {
        mockMvc.perform(get("/api/admin/documents/" + secondaryDoc.getId() + "/download")
                        .header("Authorization", "Bearer " + shopAToken))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", "attachment; filename=\"Appendix_Page2.pdf\"; filename*=UTF-8''Appendix_Page2.pdf"));
    }

    @Test
    @DisplayName("Admin A attempting to download Shop B document is rejected with 403 Forbidden")
    void testCrossShopDownloadForbidden() throws Exception {
        mockMvc.perform(get("/api/admin/documents/" + shopBDoc.getId() + "/download")
                        .header("Authorization", "Bearer " + shopAToken))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("Admin B attempting to download Shop A secondary document is rejected with 403 Forbidden")
    void testShopBCrossShopDownloadForbidden() throws Exception {
        mockMvc.perform(get("/api/admin/documents/" + secondaryDoc.getId() + "/download")
                        .header("Authorization", "Bearer " + shopBToken))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("Unauthenticated request is rejected with 401 Unauthorized")
    void testUnauthenticatedDownload() throws Exception {
        mockMvc.perform(get("/api/admin/documents/" + primaryDoc.getId() + "/download"))
                .andExpect(status().isUnauthorized());
    }
}
