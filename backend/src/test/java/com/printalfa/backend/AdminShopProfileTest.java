package com.printalfa.backend;

import com.printalfa.backend.dto.ShopDTO;
import com.printalfa.backend.entity.Shop;
import com.printalfa.backend.entity.User;
import com.printalfa.backend.enums.UserRole;
import com.printalfa.backend.repository.ShopRepository;
import com.printalfa.backend.repository.UserRepository;
import com.printalfa.backend.security.JwtTokenProvider;
import com.printalfa.backend.security.UserPrincipal;
import com.printalfa.backend.service.ShopService;
import org.junit.jupiter.api.BeforeEach;
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

import java.util.UUID;

import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ActiveProfiles("test")
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
public class AdminShopProfileTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ShopRepository shopRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private ShopService shopService;

    @Autowired
    private JwtTokenProvider jwtTokenProvider;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private User shopLessUser;
    private String shopLessToken;

    private User userA;
    private Shop shopA;
    private String tokenA;

    private User userB;
    private Shop shopB;
    private String tokenB;

    private User createUser(String email, Shop shop) {
        User user = new User();
        user.setEmail(email);
        user.setPassword(passwordEncoder.encode("password123"));
        user.setName("Test Admin");
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

    @BeforeEach
    void setUp() {
        shopLessUser = createUser("noshop_" + UUID.randomUUID() + "@shop.com", null);
        shopLessToken = tokenFor(shopLessUser);

        shopA = shopRepository.save(new Shop("Shop A", "shop-a-prof-" + UUID.randomUUID(), "Addr A", "1111111111", null));
        userA = createUser("adminA_" + UUID.randomUUID() + "@shop.com", shopA);
        tokenA = tokenFor(userA);

        shopB = shopRepository.save(new Shop("Shop B", "shop-b-prof-" + UUID.randomUUID(), "Addr B", "2222222222", null));
        userB = createUser("adminB_" + UUID.randomUUID() + "@shop.com", shopB);
        tokenB = tokenFor(userB);
    }

    @Test
    void adminWithoutShopGets404Not500() throws Exception {
        mockMvc.perform(get("/api/admin/shop")
                        .header("Authorization", "Bearer " + shopLessToken))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void adminWithoutShopQrGets404Not500() throws Exception {
        mockMvc.perform(get("/api/admin/shop/qr")
                        .header("Authorization", "Bearer " + shopLessToken))
                .andExpect(status().isNotFound());
    }

    @Test
    void adminWithoutShopUpdateGets404Not500() throws Exception {
        mockMvc.perform(put("/api/admin/shop")
                        .header("Authorization", "Bearer " + shopLessToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"New Name\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void adminWithShopGetsOwnShop() throws Exception {
        mockMvc.perform(get("/api/admin/shop")
                        .header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.id").value(shopA.getId().toString()))
                .andExpect(jsonPath("$.data.name").value("Shop A"));
    }

    @Test
    void shopAdminsAreIsolatedToOwnShop() throws Exception {
        // B sees only B's shop; A's data never leaks into B's response.
        mockMvc.perform(get("/api/admin/shop")
                        .header("Authorization", "Bearer " + tokenB))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(shopB.getId().toString()))
                .andExpect(jsonPath("$.data.id").value(
                        org.hamcrest.Matchers.not(shopA.getId().toString())));
    }

    @Test
    void missingJwtIsUnauthorized() throws Exception {
        mockMvc.perform(get("/api/admin/shop"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void invalidJwtIsUnauthorized() throws Exception {
        mockMvc.perform(get("/api/admin/shop")
                        .header("Authorization", "Bearer invalid.token.here"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void serviceNullShopIdIs400Not500() {
        assertThrows(IllegalArgumentException.class, () -> shopService.getShopById(null));
    }

    @Test
    void createdShopIsImmediatelyVisible() {
        ShopDTO request = new ShopDTO();
        request.setName("Fresh Shop");
        ShopDTO created = shopService.createShop(shopLessUser.getId(), request);
        assertNotNull(created.getId());

        ShopDTO fetched = shopService.getShopById(created.getId());
        assertEquals("Fresh Shop", fetched.getName());
        assertNull(fetched.getApiKey(), "API key must never leak on reads");
    }
}
