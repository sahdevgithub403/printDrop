package com.printalfa.backend.dto;

import java.util.UUID;

public class ShopDTO {
    private UUID id;
    private String name;
    private String slug;
    private String address;
    private String phone;
    private String logoUrl;
    private String apiKey;
    private String ownerName;
    private String city;
    private String state;
    private String pincode;
    private Boolean isOpen = true;

    public ShopDTO() {}

    public ShopDTO(UUID id, String name, String slug, String address, String phone, String logoUrl, String apiKey, String ownerName, String city, String state, String pincode) {
        this.id = id;
        this.name = name;
        this.slug = slug;
        this.address = address;
        this.phone = phone;
        this.logoUrl = logoUrl;
        this.apiKey = apiKey;
        this.ownerName = ownerName;
        this.city = city;
        this.state = state;
        this.pincode = pincode;
        this.isOpen = true;
    }

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getSlug() { return slug; }
    public void setSlug(String slug) { this.slug = slug; }

    public String getAddress() { return address; }
    public void setAddress(String address) { this.address = address; }

    public String getPhone() { return phone; }
    public void setPhone(String phone) { this.phone = phone; }

    public String getLogoUrl() { return logoUrl; }
    public void setLogoUrl(String logoUrl) { this.logoUrl = logoUrl; }

    public String getApiKey() { return apiKey; }
    public void setApiKey(String apiKey) { this.apiKey = apiKey; }

    public String getOwnerName() { return ownerName; }
    public void setOwnerName(String ownerName) { this.ownerName = ownerName; }

    public String getCity() { return city; }
    public void setCity(String city) { this.city = city; }

    public String getState() { return state; }
    public void setState(String state) { this.state = state; }

    public String getPincode() { return pincode; }
    public void setPincode(String pincode) { this.pincode = pincode; }

    public Boolean getIsOpen() { return isOpen != null ? isOpen : true; }
    public void setIsOpen(Boolean isOpen) { this.isOpen = isOpen; }
}
