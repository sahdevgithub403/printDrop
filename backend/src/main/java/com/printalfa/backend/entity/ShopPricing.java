package com.printalfa.backend.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(name = "shop_pricings")
@Getter
@Setter
@AllArgsConstructor
@Builder
public class ShopPricing {

    public ShopPricing() {}

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "shop_id", nullable = false, unique = true)
    private Shop shop;

    @Column(nullable = false)
    private BigDecimal bwA4Single;

    @Column(nullable = false)
    private BigDecimal bwA4Double;

    @Column(nullable = false)
    private BigDecimal colorA4Single;

    @Column(nullable = false)
    private BigDecimal colorA4Double;

    @Column(nullable = false)
    private BigDecimal bwA3Single;

    @Column(nullable = false)
    private BigDecimal bwA3Double;

    @Column(nullable = false)
    private BigDecimal colorA3Single;

    @Column(nullable = false)
    private BigDecimal colorA3Double;

    @Column(nullable = false, precision = 10, scale = 2)
    @Builder.Default
    private BigDecimal passportPrice = new BigDecimal("50.00");

    public ShopPricing(Shop shop, BigDecimal bwA4Single, BigDecimal bwA4Double,
                       BigDecimal colorA4Single, BigDecimal colorA4Double,
                       BigDecimal bwA3Single, BigDecimal bwA3Double,
                       BigDecimal colorA3Single, BigDecimal colorA3Double,
                       BigDecimal passportPrice) {
        this.shop = shop;
        this.bwA4Single = bwA4Single;
        this.bwA4Double = bwA4Double;
        this.colorA4Single = colorA4Single;
        this.colorA4Double = colorA4Double;
        this.bwA3Single = bwA3Single;
        this.bwA3Double = bwA3Double;
        this.colorA3Single = colorA3Single;
        this.colorA3Double = colorA3Double;
        this.passportPrice = passportPrice != null ? passportPrice : new BigDecimal("50.00");
    }
}
