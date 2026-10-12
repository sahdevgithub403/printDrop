package com.printalfa.backend.dto;

import java.math.BigDecimal;
import java.util.UUID;

public class ShopPricingDTO {
    private UUID id;
    private UUID shopId;
    private BigDecimal bwA4Single;
    private BigDecimal bwA4Double;
    private BigDecimal colorA4Single;
    private BigDecimal colorA4Double;
    private BigDecimal bwA3Single;
    private BigDecimal bwA3Double;
    private BigDecimal colorA3Single;
    private BigDecimal colorA3Double;
    private BigDecimal passportPrice;

    public ShopPricingDTO() {}

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }

    public UUID getShopId() { return shopId; }
    public void setShopId(UUID shopId) { this.shopId = shopId; }

    public BigDecimal getBwA4Single() { return bwA4Single; }
    public void setBwA4Single(BigDecimal bwA4Single) { this.bwA4Single = bwA4Single; }

    public BigDecimal getBwA4Double() { return bwA4Double; }
    public void setBwA4Double(BigDecimal bwA4Double) { this.bwA4Double = bwA4Double; }

    public BigDecimal getColorA4Single() { return colorA4Single; }
    public void setColorA4Single(BigDecimal colorA4Single) { this.colorA4Single = colorA4Single; }

    public BigDecimal getColorA4Double() { return colorA4Double; }
    public void setColorA4Double(BigDecimal colorA4Double) { this.colorA4Double = colorA4Double; }

    public BigDecimal getBwA3Single() { return bwA3Single; }
    public void setBwA3Single(BigDecimal bwA3Single) { this.bwA3Single = bwA3Single; }

    public BigDecimal getBwA3Double() { return bwA3Double; }
    public void setBwA3Double(BigDecimal bwA3Double) { this.bwA3Double = bwA3Double; }

    public BigDecimal getColorA3Single() { return colorA3Single; }
    public void setColorA3Single(BigDecimal colorA3Single) { this.colorA3Single = colorA3Single; }

    public BigDecimal getColorA3Double() { return colorA3Double; }
    public void setColorA3Double(BigDecimal colorA3Double) { this.colorA3Double = colorA3Double; }

    public BigDecimal getPassportPrice() { return passportPrice; }
    public void setPassportPrice(BigDecimal passportPrice) { this.passportPrice = passportPrice; }
}
