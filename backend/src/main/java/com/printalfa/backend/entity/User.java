package com.printalfa.backend.entity;

import com.printalfa.backend.enums.UserRole;
import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "app_users")
@Getter
@Setter
@AllArgsConstructor
@Builder
public class User {

    public User() {}

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(nullable = false)
    private String password;

    private String name;
    private String phone;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private UserRole role;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "shop_id")
    private Shop shop;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
    }

    public User(String email, String password, UserRole role, Shop shop) {
        this.email = email;
        this.password = password;
        this.role = role;
        this.shop = shop;
    }

    public User(String email, String password, UserRole role, Shop shop, String name, String phone) {
        this.email = email;
        this.password = password;
        this.role = role;
        this.shop = shop;
        this.name = name;
        this.phone = phone;
    }
}
