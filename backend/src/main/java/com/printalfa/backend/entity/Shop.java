package com.printalfa.backend.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "shops")
@Getter
@Setter
@AllArgsConstructor
@Builder
public class Shop {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false, unique = true)
    private String slug;

    private String address;
    private String phone;
    private String logoUrl;
    
    private String ownerName;
    private String city;
    private String state;
    private String pincode;

    @Builder.Default
    private Boolean isOpen = true;

    @Column(unique = true)
    private String apiKey;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        if (this.apiKey == null || this.apiKey.trim().isEmpty()) {
            this.apiKey = "pa_live_" + UUID.randomUUID().toString().replace("-", "");
        }
    }

    public Shop() {}

    public Shop(String name, String slug, String address, String phone, String logoUrl) {
        this.name = name;
        this.slug = slug;
        this.address = address;
        this.phone = phone;
        this.logoUrl = logoUrl;
    }

    public Shop(String name, String slug, String address, String phone, String logoUrl, String ownerName, String city, String state, String pincode) {
        this.name = name;
        this.slug = slug;
        this.address = address;
        this.phone = phone;
        this.logoUrl = logoUrl;
        this.ownerName = ownerName;
        this.city = city;
        this.state = state;
        this.pincode = pincode;
        this.apiKey = "pa_live_" + UUID.randomUUID().toString().replace("-", "");
    }
}
