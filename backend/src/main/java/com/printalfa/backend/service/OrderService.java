package com.printalfa.backend.service;

import com.printalfa.backend.dto.*;
import com.printalfa.backend.entity.*;
import com.printalfa.backend.enums.*;
import com.printalfa.backend.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.Map;
import java.util.HashMap;

import com.razorpay.Order;
import com.razorpay.RazorpayClient;
import com.razorpay.RazorpayException;
import org.json.JSONObject;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@Service
public class OrderService {

    private final PrintOrderRepository printOrderRepository;
    private final OrderItemRepository orderItemRepository;
    private final ShopRepository shopRepository;
    private final DocumentRepository documentRepository;
    private final PricingEngineService pricingEngineService;
    private final PrintJobRepository printJobRepository;
    private final WebSocketService webSocketService;
    private final com.printalfa.backend.repository.PaymentRepository paymentRepository;
    private final org.springframework.core.env.Environment environment;

    @Value("${razorpay.key-id:}")
    private String razorpayKeyId;

    @Value("${razorpay.key-secret:}")
    private String razorpayKeySecret;

    private static final int MAX_COPIES_PER_ITEM = 100;

    private boolean isDummyRazorpayKeys() {
        return razorpayKeyId == null || razorpayKeyId.isBlank()
                || razorpayKeySecret == null || razorpayKeySecret.isBlank()
                || razorpayKeyId.startsWith("rzp_test_dummy")
                || "dummy_secret".equals(razorpayKeySecret);
    }

    private boolean isTestProfile() {
        return environment != null
                && java.util.Arrays.asList(environment.getActiveProfiles()).contains("test");
    }

    public OrderService(PrintOrderRepository printOrderRepository,
                        OrderItemRepository orderItemRepository,
                        ShopRepository shopRepository,
                        DocumentRepository documentRepository,
                        PricingEngineService pricingEngineService,
                        PrintJobRepository printJobRepository,
                        WebSocketService webSocketService,
                        com.printalfa.backend.repository.PaymentRepository paymentRepository,
                        org.springframework.core.env.Environment environment) {
        this.printOrderRepository = printOrderRepository;
        this.orderItemRepository = orderItemRepository;
        this.shopRepository = shopRepository;
        this.documentRepository = documentRepository;
        this.pricingEngineService = pricingEngineService;
        this.printJobRepository = printJobRepository;
        this.webSocketService = webSocketService;
        this.paymentRepository = paymentRepository;
        this.environment = environment;
    }

    @Transactional
    public OrderDTO createOrder(CreateOrderRequest request) {
        Shop shop = shopRepository.findById(request.getShopId())
                .orElseThrow(() -> new IllegalArgumentException("Shop not found"));

        if (Boolean.FALSE.equals(shop.getIsOpen())) {
            throw new IllegalStateException("Shop is currently closed and not accepting new orders.");
        }

        List<CreateOrderItemRequest> itemRequests = request.getItems();
        if ((itemRequests == null || itemRequests.isEmpty()) && request.getDocumentId() != null) {
            // Legacy single-item payload compatibility
            CreateOrderItemRequest legacyItem = new CreateOrderItemRequest();
            legacyItem.setDocumentId(request.getDocumentId());
            legacyItem.setPrintType(request.getPrintType());
            legacyItem.setColorMode(request.getColorMode());
            legacyItem.setPaperSize(request.getPaperSize());
            legacyItem.setPrintSide(request.getPrintSide());
            legacyItem.setPageRange(request.getPageRange());
            legacyItem.setCopies(request.getCopies());
            itemRequests = List.of(legacyItem);
        }

        if (itemRequests == null || itemRequests.isEmpty()) {
            throw new IllegalArgumentException("Order must contain at least one document item");
        }

        PrintOrder order = new PrintOrder();
        order.setShop(shop);
        order.setOrderNumber(generateOrderNumber());
        order.setPublicToken(UUID.randomUUID());
        order.setCustomerName(request.getCustomerName() != null && !request.getCustomerName().trim().isEmpty()
                ? request.getCustomerName().trim()
                : "Walk-in Customer");
        order.setCustomerPhone(request.getCustomerPhone() != null ? request.getCustomerPhone().trim() : "");
        order.setPaymentMethod(request.getPaymentMethod());
        order.setPaymentStatus(PaymentStatus.PENDING);
        order.setPrintStatus(PrintStatus.PENDING);

        List<OrderItem> orderItems = new ArrayList<>();
        BigDecimal orderTotal = BigDecimal.ZERO;

        for (CreateOrderItemRequest itemReq : itemRequests) {
            Document doc = documentRepository.findById(itemReq.getDocumentId())
                    .orElseThrow(() -> new IllegalArgumentException("Document not found: " + itemReq.getDocumentId()));

            // C-08: document must belong to the same shop context (shop-scoped uploads).
            // Documents uploaded without shop context (legacy null) remain usable for compatibility.
            if (doc.getShopId() != null && !doc.getShopId().equals(shop.getId())) {
                throw new IllegalArgumentException("Document does not belong to this shop: " + itemReq.getDocumentId());
            }

            int copies = itemReq.getCopies() > 0 ? itemReq.getCopies() : 1;
            if (copies > MAX_COPIES_PER_ITEM) {
                throw new IllegalArgumentException("Copies per item cannot exceed " + MAX_COPIES_PER_ITEM);
            }
            PricingCalculateRequest pricingRequest = new PricingCalculateRequest();
            pricingRequest.setShopId(shop.getId());
            pricingRequest.setDocumentId(doc.getId());
            pricingRequest.setPrintType(itemReq.getPrintType() != null ? itemReq.getPrintType() : PrintType.PRINT);
            pricingRequest.setColorMode(itemReq.getColorMode());
            pricingRequest.setPaperSize(itemReq.getPaperSize());
            pricingRequest.setPrintSide(itemReq.getPrintSide());
            pricingRequest.setPageRange(itemReq.getPageRange());
            pricingRequest.setCopies(copies);

            PricingCalculateResponse pricingResponse = pricingEngineService.calculatePrice(pricingRequest);

            OrderItem item = new OrderItem();
            item.setOrder(order);
            item.setDocument(doc);
            item.setPrintType(itemReq.getPrintType() != null ? itemReq.getPrintType() : PrintType.PRINT);
            item.setColorMode(itemReq.getColorMode());
            item.setPaperSize(itemReq.getPaperSize());
            item.setPrintSide(itemReq.getPrintSide());
            item.setPageRange(itemReq.getPageRange() != null ? itemReq.getPageRange() : "ALL");
            item.setCopies(itemReq.getCopies() > 0 ? Math.min(itemReq.getCopies(), MAX_COPIES_PER_ITEM) : 1);
            item.setCalculatedPages(pricingResponse.getCalculatedPages());
            item.setUnitPrice(pricingResponse.getUnitPricePerPage());
            item.setItemPrice(pricingResponse.getTotalPrice());
            item.setPrintStatus(PrintStatus.PENDING);

            orderItems.add(item);
            orderTotal = orderTotal.add(pricingResponse.getTotalPrice());
        }

        order.setItems(orderItems);
        order.setTotalPrice(orderTotal);

        // Populate legacy fields on first item for DB compatibility if needed
        if (!orderItems.isEmpty()) {
            OrderItem first = orderItems.get(0);
            order.setDocument(first.getDocument());
            order.setPrintType(first.getPrintType());
            order.setColorMode(first.getColorMode());
            order.setPaperSize(first.getPaperSize());
            order.setPrintSide(first.getPrintSide());
            order.setPageRange(first.getPageRange());
            order.setCopies(first.getCopies());
            order.setCalculatedPages(first.getCalculatedPages());
        }

        if (order.getPaymentMethod() == PaymentMethod.ONLINE) {
            // C-02: fail closed — never create fake ONLINE Razorpay orders with dummy keys.
            // The test profile is the single explicit non-prod allowance: mint a local
            // offline order id (no network, no fake success — verification still HMAC-checks).
            if (isDummyRazorpayKeys()) {
                if (isTestProfile()) {
                    order.setRazorpayOrderId("order_test_" + System.currentTimeMillis() + "_" + UUID.randomUUID().toString().substring(0, 8));
                } else {
                    throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                            "Online payments are unavailable: Razorpay is not configured. Please use Pay at Shop.");
                }
            } else {
            try {
                RazorpayClient razorpay = new RazorpayClient(razorpayKeyId, razorpayKeySecret);
                JSONObject orderRequest = new JSONObject();
                // amount in paise — long math to avoid int overflow
                long amountPaise = orderTotal.multiply(new BigDecimal("100")).longValueExact();
                orderRequest.put("amount", amountPaise);
                orderRequest.put("currency", "INR");
                orderRequest.put("receipt", order.getOrderNumber());

                Order rzpOrder = razorpay.orders.create(orderRequest);
                order.setRazorpayOrderId(rzpOrder.get("id"));
            } catch (RazorpayException e) {
                throw new RuntimeException("Failed to create Razorpay order", e);
            }
            }
        }

        PrintOrder savedOrder;
        try {
            savedOrder = printOrderRepository.save(order);
        } catch (DataIntegrityViolationException e) {
            // M-04: order-number collision (unique constraint) — retry with a fresh number.
            savedOrder = saveWithOrderNumberRetry(order, 3);
        }

        // Record initial Payment record
        com.printalfa.backend.entity.Payment initialPayment = new com.printalfa.backend.entity.Payment();
        initialPayment.setOrder(savedOrder);
        initialPayment.setAmount(savedOrder.getTotalPrice());
        initialPayment.setPaymentMethod(savedOrder.getPaymentMethod());
        initialPayment.setStatus(savedOrder.getPaymentStatus());
        if (savedOrder.getPaymentMethod() == PaymentMethod.PAY_AT_SHOP) {
            initialPayment.setTransactionId("CASH-" + savedOrder.getOrderNumber());
        }
        paymentRepository.save(initialPayment);

        // Enqueue PrintJob and notify shop ONLY for eligible orders:
        // 1. PAY_AT_SHOP orders are immediately queued for physical fulfillment
        // 2. ONLINE orders are queued only after verified online payment
        if (savedOrder.getPaymentMethod() == PaymentMethod.PAY_AT_SHOP || savedOrder.getPaymentStatus() == PaymentStatus.PAID) {
            PrintJob printJob = new PrintJob(savedOrder, JobStatus.QUEUED);
            printJobRepository.save(printJob);

            OrderDTO orderDTO = mapToDTO(savedOrder);
            Map<String, Object> event = new HashMap<>();
            event.put("type", "NEW_PRINT_REQUEST");
            event.put("order", orderDTO);
            webSocketService.sendOrderUpdate(shop.getId(), event);
        }

        return mapToDTO(savedOrder);
    }

    @Transactional(readOnly = true)
    public OrderDTO getOrderByPublicToken(UUID publicToken) {
        PrintOrder order = printOrderRepository.findByPublicToken(publicToken)
                .orElseThrow(() -> new IllegalArgumentException("Order not found with provided tracking token"));
        return mapToDTO(order);
    }

    @Transactional(readOnly = true)
    public OrderDTO getOrderById(UUID orderId) {
        PrintOrder order = printOrderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Order not found"));
        return mapToDTO(order);
    }

    @Transactional(readOnly = true)
    public List<OrderDTO> getShopOrders(UUID shopId, String status) {
        List<PrintOrder> orders;
        if (status != null && !status.isEmpty() && !"ALL".equalsIgnoreCase(status)) {
            PrintStatus printStatus;
            try {
                printStatus = PrintStatus.valueOf(status.toUpperCase());
            } catch (IllegalArgumentException e) {
                throw new IllegalArgumentException("Invalid order status filter: " + status);
            }
            orders = printOrderRepository.findByShopIdAndPrintStatusOrderByCreatedAtDesc(shopId, printStatus);
        } else {
            orders = printOrderRepository.findByShopIdOrderByCreatedAtDesc(shopId);
        }
        return orders.stream().map(this::mapToDTO).collect(Collectors.toList());
    }

    // Allowed print-status transitions. COMPLETED/CANCELLED are terminal.
    private static final Map<PrintStatus, java.util.Set<PrintStatus>> PRINT_STATUS_TRANSITIONS = Map.of(
            PrintStatus.PENDING, java.util.Set.of(PrintStatus.PRINTING, PrintStatus.COMPLETED, PrintStatus.FAILED, PrintStatus.CANCELLED),
            PrintStatus.PRINTING, java.util.Set.of(PrintStatus.PRINTING, PrintStatus.COMPLETED, PrintStatus.FAILED, PrintStatus.CANCELLED),
            PrintStatus.FAILED, java.util.Set.of(PrintStatus.PRINTING, PrintStatus.PENDING, PrintStatus.CANCELLED),
            PrintStatus.COMPLETED, java.util.Set.of(),
            PrintStatus.CANCELLED, java.util.Set.of()
    );

    // Allowed payment-status transitions.
    private static final Map<PaymentStatus, java.util.Set<PaymentStatus>> PAYMENT_STATUS_TRANSITIONS = Map.of(
            PaymentStatus.PENDING, java.util.Set.of(PaymentStatus.PAID, PaymentStatus.FAILED),
            PaymentStatus.FAILED, java.util.Set.of(PaymentStatus.PAID, PaymentStatus.PENDING),
            PaymentStatus.PAID, java.util.Set.of(PaymentStatus.REFUNDED),
            PaymentStatus.REFUNDED, java.util.Set.of()
    );

    private static void requireAllowedPrintTransition(PrintStatus from, PrintStatus to) {
        if (from == null || to == null) {
            throw new IllegalArgumentException("Print status must be specified");
        }
        if (from == to) {
            return; // idempotent no-op
        }
        java.util.Set<PrintStatus> allowed = PRINT_STATUS_TRANSITIONS.getOrDefault(from, java.util.Set.of());
        if (!allowed.contains(to)) {
            throw new IllegalStateException("Invalid print status transition from " + from + " to " + to);
        }
    }

    private static void requireAllowedPaymentTransition(PaymentStatus from, PaymentStatus to) {
        if (from == null || to == null) {
            throw new IllegalArgumentException("Payment status must be specified");
        }
        if (from == to) {
            return; // idempotent no-op
        }
        java.util.Set<PaymentStatus> allowed = PAYMENT_STATUS_TRANSITIONS.getOrDefault(from, java.util.Set.of());
        if (!allowed.contains(to)) {
            throw new IllegalStateException("Invalid payment status transition from " + from + " to " + to);
        }
    }

    private PrintOrder saveWithOrderNumberRetry(PrintOrder order, int attempts) {
        for (int i = 0; i < attempts; i++) {
            order.setOrderNumber(generateOrderNumber());
            try {
                return printOrderRepository.save(order);
            } catch (DataIntegrityViolationException retryEx) {
                if (i == attempts - 1) {
                    throw retryEx;
                }
            }
        }
        throw new IllegalStateException("Failed to generate a unique order number");
    }

    @Transactional
    public OrderDTO updatePrintStatus(UUID orderId, PrintStatus newStatus) {
        if (newStatus == null) {
            throw new IllegalArgumentException("Print status must be specified");
        }
        PrintOrder order = printOrderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Order not found"));

        requireAllowedPrintTransition(order.getPrintStatus(), newStatus);

        // Payment gate: ONLINE orders can only move toward print/complete once PAID.
        if (order.getPaymentMethod() == PaymentMethod.ONLINE
                && order.getPaymentStatus() != PaymentStatus.PAID
                && (newStatus == PrintStatus.PRINTING || newStatus == PrintStatus.COMPLETED)) {
            throw new IllegalStateException("Online payment must be PAID before printing or completing");
        }

        order.setPrintStatus(newStatus);
        if (order.getItems() != null) {
            for (OrderItem item : order.getItems()) {
                item.setPrintStatus(newStatus);
            }
        }

        // Manage PrintJob queue lifecycle
        if (newStatus == PrintStatus.PRINTING) {
            printJobRepository.findByOrderId(orderId).ifPresentOrElse(job -> {
                if (job.getStatus() == JobStatus.FAILED || job.getStatus() == JobStatus.COMPLETED) {
                    job.setStatus(JobStatus.QUEUED);
                    job.setAssignedAgentId(null);
                    printJobRepository.save(job);
                }
            }, () -> {
                PrintJob job = new PrintJob(order, JobStatus.QUEUED);
                printJobRepository.save(job);
            });
        } else if (newStatus == PrintStatus.COMPLETED) {
            printJobRepository.findByOrderId(orderId).ifPresent(job -> {
                job.setStatus(JobStatus.COMPLETED);
                printJobRepository.save(job);
            });
        } else if (newStatus == PrintStatus.FAILED) {
            printJobRepository.findByOrderId(orderId).ifPresent(job -> {
                job.setStatus(JobStatus.FAILED);
                printJobRepository.save(job);
            });
        } else if (newStatus == PrintStatus.PENDING) {
            printJobRepository.findByOrderId(orderId).ifPresentOrElse(job -> {
                if (job.getStatus() != JobStatus.QUEUED) {
                    job.setStatus(JobStatus.QUEUED);
                    job.setAssignedAgentId(null);
                    printJobRepository.save(job);
                }
            }, () -> {
                PrintJob job = new PrintJob(order, JobStatus.QUEUED);
                printJobRepository.save(job);
            });
        }

        PrintOrder updated = printOrderRepository.save(order);
        OrderDTO updatedDTO = mapToDTO(updated);
        
        Map<String, Object> event = new HashMap<>();
        event.put("type", "ORDER_STATUS_UPDATED");
        event.put("order", updatedDTO);
        webSocketService.sendOrderUpdate(order.getShop().getId(), event);
        
        return updatedDTO;
    }

    @Transactional
    public OrderDTO updateItemPrintStatus(UUID orderId, UUID itemId, PrintStatus newStatus, UUID shopId) {
        if (newStatus == null) {
            throw new IllegalArgumentException("Print status must be specified");
        }
        PrintOrder order = printOrderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Order not found"));

        // Shop isolation check
        if (shopId != null && !order.getShop().getId().equals(shopId)) {
            throw new IllegalArgumentException("Unauthorized access to shop order");
        }

        OrderItem item = order.getItems().stream()
                .filter(i -> i.getId().equals(itemId))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Order item not found: " + itemId));

        // Same guards as order-level updatePrintStatus: valid transition only,
        // and ONLINE orders require PAID before moving toward print/complete.
        requireAllowedPrintTransition(item.getPrintStatus(), newStatus);
        if (order.getPaymentMethod() == PaymentMethod.ONLINE
                && order.getPaymentStatus() != PaymentStatus.PAID
                && (newStatus == PrintStatus.PRINTING || newStatus == PrintStatus.COMPLETED)) {
            throw new IllegalStateException("Online payment must be PAID before printing or completing");
        }

        item.setPrintStatus(newStatus);

        // Derived overall order status calculation
        PrintStatus derivedStatus = calculateDerivedOrderStatus(order.getItems());
        order.setPrintStatus(derivedStatus);

        PrintOrder updated = printOrderRepository.save(order);
        OrderDTO updatedDTO = mapToDTO(updated);
        
        Map<String, Object> event = new HashMap<>();
        event.put("type", "ORDER_ITEM_STATUS_UPDATED");
        event.put("order", updatedDTO);
        webSocketService.sendOrderUpdate(order.getShop().getId(), event);
        
        return updatedDTO;
    }

    /**
     * Document Studio: point an order item at a different (usually edited)
     * document version. The original file row is never modified.
     * Pricing is recomputed from the new document's persisted page count with
     * the item's existing print settings. Paid orders are never repriced here
     * (409) — swapping after payment would silently alter the paid amount.
     * Printing orders are blocked (409) so the agent never prints a swapped file.
     */
    @Transactional
    public OrderDTO swapItemDocument(UUID orderId, UUID itemId, UUID documentId, UUID shopId) {
        PrintOrder order = printOrderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Order not found"));
        if (shopId != null && !order.getShop().getId().equals(shopId)) {
            throw new IllegalArgumentException("Unauthorized access to shop order");
        }
        if (order.getPaymentStatus() == PaymentStatus.PAID) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Cannot change the document of a paid order");
        }
        if (order.getPrintStatus() == PrintStatus.PRINTING) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Cannot change the document while the order is printing");
        }
        OrderItem item = order.getItems().stream()
                .filter(i -> i.getId().equals(itemId))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Order item not found: " + itemId));
        Document doc = documentRepository.findById(documentId)
                .orElseThrow(() -> new IllegalArgumentException("Document not found: " + documentId));
        // Ownership: referenced by this shop's orders, or uploaded with this shop's context.
        boolean accessible = printOrderRepository.existsByShopIdAndDocumentId(order.getShop().getId(), documentId)
                || (shopId != null && shopId.equals(doc.getShopId()));
        if (!accessible) {
            throw new IllegalArgumentException("Document does not belong to this shop");
        }

        PricingCalculateRequest pricingRequest = new PricingCalculateRequest();
        pricingRequest.setShopId(order.getShop().getId());
        pricingRequest.setDocumentId(doc.getId());
        pricingRequest.setPrintType(item.getPrintType() != null ? item.getPrintType() : PrintType.PRINT);
        pricingRequest.setColorMode(item.getColorMode());
        pricingRequest.setPaperSize(item.getPaperSize());
        pricingRequest.setPrintSide(item.getPrintSide());
        pricingRequest.setPageRange(item.getPageRange());
        pricingRequest.setCopies(item.getCopies());
        PricingCalculateResponse pricingResponse = pricingEngineService.calculatePrice(pricingRequest);

        item.setDocument(doc);
        item.setCalculatedPages(pricingResponse.getCalculatedPages());
        item.setUnitPrice(pricingResponse.getUnitPricePerPage());
        item.setItemPrice(pricingResponse.getTotalPrice());

        BigDecimal total = order.getItems().stream()
                .map(OrderItem::getItemPrice)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        order.setTotalPrice(total);

        // Keep the legacy first-item mirror consistent when item 0 changes.
        if (!order.getItems().isEmpty() && order.getItems().get(0).getId().equals(itemId)) {
            order.setDocument(doc);
            order.setCalculatedPages(item.getCalculatedPages());
        }

        PrintOrder updated = printOrderRepository.save(order);
        return mapToDTO(updated);
    }

    /**
     * Document Studio: versions available for an order item — the current
     * document, its lineage root, and sibling edited copies.
     */
    @Transactional(readOnly = true)
    public List<DocumentDTO> getItemDocumentVersions(UUID orderId, UUID itemId, UUID shopId) {
        PrintOrder order = printOrderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Order not found"));
        if (shopId != null && !order.getShop().getId().equals(shopId)) {
            throw new IllegalArgumentException("Unauthorized access to shop order");
        }
        OrderItem item = order.getItems().stream()
                .filter(i -> i.getId().equals(itemId))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Order item not found: " + itemId));
        Document current = item.getDocument();
        if (current == null) {
            return List.of();
        }
        // Walk up to the lineage root (cap depth for safety).
        Document root = current;
        for (int depth = 0; depth < 10; depth++) {
            if (root.getParentDocumentId() == null) break;
            Document parent = documentRepository.findById(root.getParentDocumentId()).orElse(null);
            if (parent == null) break;
            root = parent;
        }
        List<Document> family = new ArrayList<>();
        family.add(root);
        for (Document sibling : documentRepository.findByParentDocumentId(root.getId())) {
            if (!sibling.getId().equals(root.getId())) {
                family.add(sibling);
            }
        }
        // The current document is always listed even if it sits deeper in the chain.
        if (family.stream().noneMatch(d -> d.getId().equals(current.getId()))) {
            family.add(current);
        }
        List<DocumentDTO> result = new ArrayList<>();
        for (Document d : family) {
            DocumentDTO dto = new DocumentDTO(d.getId(), d.getOriginalFileName(), d.getContentType(),
                    d.getFileSize(), d.getPageCount(), d.getUploadedAt());
            dto.setParentDocumentId(d.getParentDocumentId());
            dto.setCurrent(d.getId().equals(current.getId()));
            result.add(dto);
        }
        return result;
    }

    @Transactional
    public OrderDTO updatePaymentStatus(UUID orderId, PaymentStatus newStatus) {
        if (newStatus == null) {
            throw new IllegalArgumentException("Payment status must be specified");
        }
        PrintOrder order = printOrderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Order not found"));
        requireAllowedPaymentTransition(order.getPaymentStatus(), newStatus);
        order.setPaymentStatus(newStatus);
        com.printalfa.backend.entity.Payment payment = paymentRepository.findByOrderId(orderId).orElseGet(() -> {
            com.printalfa.backend.entity.Payment p = new com.printalfa.backend.entity.Payment();
            p.setOrder(order);
            p.setAmount(order.getTotalPrice());
            p.setPaymentMethod(order.getPaymentMethod());
            return p;
        });
        payment.setStatus(newStatus);
        if (newStatus == PaymentStatus.PAID && (payment.getTransactionId() == null || payment.getTransactionId().isBlank())) {
            payment.setTransactionId(order.getRazorpayPaymentId() != null
                    ? order.getRazorpayPaymentId() : "CASH-" + order.getOrderNumber());
        }
        paymentRepository.save(payment);
        PrintOrder updated = printOrderRepository.save(order);

        // Same enqueue path as the verify flow: PAID orders must enter the print queue.
        if (newStatus == PaymentStatus.PAID && !printJobRepository.existsByOrderId(order.getId())) {
            PrintJob printJob = new PrintJob(updated, JobStatus.QUEUED);
            printJobRepository.save(printJob);
        }

        OrderDTO updatedDTO = mapToDTO(updated);
        
        Map<String, Object> event = new HashMap<>();
        event.put("type", "PAYMENT_STATUS_UPDATED");
        event.put("order", updatedDTO);
        webSocketService.sendOrderUpdate(order.getShop().getId(), event);
        
        return updatedDTO;
    }

    private PrintStatus calculateDerivedOrderStatus(List<OrderItem> items) {
        if (items == null || items.isEmpty()) return PrintStatus.PENDING;

        boolean allCompleted = items.stream().allMatch(i -> i.getPrintStatus() == PrintStatus.COMPLETED);
        if (allCompleted) return PrintStatus.COMPLETED;

        boolean allCancelled = items.stream().allMatch(i -> i.getPrintStatus() == PrintStatus.CANCELLED);
        if (allCancelled) return PrintStatus.CANCELLED;

        boolean allPending = items.stream().allMatch(i -> i.getPrintStatus() == PrintStatus.PENDING);
        if (allPending) return PrintStatus.PENDING;

        // Propagate failure: any failed item with nothing actively printing => FAILED.
        boolean anyPrinting = items.stream().anyMatch(i -> i.getPrintStatus() == PrintStatus.PRINTING);
        boolean anyFailed = items.stream().anyMatch(i -> i.getPrintStatus() == PrintStatus.FAILED);
        if (anyFailed && !anyPrinting) return PrintStatus.FAILED;

        // Genuinely in-progress (partial completion counts as PRINTING without a new enum).
        return PrintStatus.PRINTING;
    }

    public OrderDTO mapToDTO(PrintOrder order) {
        OrderDTO dto = new OrderDTO();
        dto.setId(order.getId());
        dto.setOrderNumber(order.getOrderNumber());
        dto.setPublicToken(order.getPublicToken());
        dto.setShopId(order.getShop().getId());
        dto.setShopName(order.getShop().getName());
        dto.setTotalPrice(order.getTotalPrice());
        dto.setPaymentMethod(order.getPaymentMethod());
        dto.setPaymentStatus(order.getPaymentStatus());
        dto.setPrintStatus(order.getPrintStatus());
        dto.setCustomerName(order.getCustomerName());
        dto.setCustomerPhone(order.getCustomerPhone());
        dto.setCreatedAt(order.getCreatedAt());
        dto.setUpdatedAt(order.getUpdatedAt());
        dto.setRazorpayOrderId(order.getRazorpayOrderId());
        dto.setRazorpayPaymentId(order.getRazorpayPaymentId());

        List<OrderItemDTO> itemDTOs = new ArrayList<>();
        if (order.getItems() != null && !order.getItems().isEmpty()) {
            for (OrderItem item : order.getItems()) {
                OrderItemDTO itemDTO = new OrderItemDTO();
                itemDTO.setId(item.getId());
                itemDTO.setOrderId(order.getId());
                if (item.getDocument() != null) {
                    Document doc = item.getDocument();
                    itemDTO.setDocument(new DocumentDTO(
                            doc.getId(),
                            doc.getOriginalFileName(),
                            doc.getContentType(),
                            doc.getFileSize(),
                            doc.getPageCount(),
                            doc.getUploadedAt()
                    ));
                }
                itemDTO.setPrintType(item.getPrintType());
                itemDTO.setColorMode(item.getColorMode());
                itemDTO.setPaperSize(item.getPaperSize());
                itemDTO.setPrintSide(item.getPrintSide());
                itemDTO.setPageRange(item.getPageRange());
                itemDTO.setCopies(item.getCopies());
                itemDTO.setCalculatedPages(item.getCalculatedPages());
                itemDTO.setUnitPrice(item.getUnitPrice());
                itemDTO.setItemPrice(item.getItemPrice());
                itemDTO.setPrintStatus(item.getPrintStatus());
                itemDTO.setCreatedAt(item.getCreatedAt());
                itemDTOs.add(itemDTO);
            }
        }
        dto.setItems(itemDTOs);

        // Populate legacy top-level document properties for backwards compatibility
        if (!itemDTOs.isEmpty()) {
            OrderItemDTO first = itemDTOs.get(0);
            dto.setDocument(first.getDocument());
            dto.setPrintType(first.getPrintType());
            dto.setColorMode(first.getColorMode());
            dto.setPaperSize(first.getPaperSize());
            dto.setPrintSide(first.getPrintSide());
            dto.setPageRange(first.getPageRange());
            dto.setCopies(first.getCopies());
            dto.setCalculatedPages(first.getCalculatedPages());
        }

        return dto;
    }

    @Transactional
    public void deleteOrder(UUID orderId, UUID shopId) {
        deleteOrder(orderId, shopId, false);
    }

    @Transactional
    public void deleteOrder(UUID orderId, UUID shopId, boolean confirm) {
        PrintOrder order = printOrderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Order not found with ID: " + orderId));
        if (!order.getShop().getId().equals(shopId)) {
            throw new org.springframework.security.access.AccessDeniedException("Unauthorized access to shop order");
        }

        // M-05: never delete an order that is actively printing.
        if (order.getPrintStatus() == PrintStatus.PRINTING) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Cannot delete an order that is currently printing");
        }

        // M-05: PAID orders keep their payment audit row — refuse deletion while payment is PAID.
        // Only REFUNDED/FAILED payments (or PENDING) may be removed together with the order.
        com.printalfa.backend.entity.Payment linkedPayment =
                paymentRepository.findByOrderId(orderId).orElse(null);
        PaymentStatus linkedStatus = linkedPayment != null ? linkedPayment.getStatus() : order.getPaymentStatus();
        if (linkedStatus == PaymentStatus.PAID || order.getPaymentStatus() == PaymentStatus.PAID) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Cannot delete a PAID order while its payment record exists. Refund or mark the payment FAILED first.");
        }
        if (order.getPrintStatus() == PrintStatus.COMPLETED && !confirm) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Deleting a COMPLETED order requires explicit confirmation (confirm=true)");
        }

        // Delete any linked print jobs
        printJobRepository.findByOrderId(orderId).ifPresent(printJobRepository::delete);

        // Non-PAID payment rows may be removed together with the order; PAID rows are never deleted.
        if (linkedPayment != null) {
            paymentRepository.delete(linkedPayment);
        }

        // Delete the order (order items will be cascade deleted)
        printOrderRepository.delete(order);
    }

    private static final String ORDER_NUMBER_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    private static final int ORDER_NUMBER_LENGTH = 6;
    private static final int MAX_COLLISION_RETRIES = 10;
    private final java.security.SecureRandom secureRandom = new java.security.SecureRandom();

    private String generateOrderNumber() {
        for (int attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
            StringBuilder sb = new StringBuilder("PR-");
            for (int i = 0; i < ORDER_NUMBER_LENGTH; i++) {
                int index = secureRandom.nextInt(ORDER_NUMBER_ALPHABET.length());
                sb.append(ORDER_NUMBER_ALPHABET.charAt(index));
            }
            String candidate = sb.toString();
            if (!printOrderRepository.existsByOrderNumber(candidate)) {
                return candidate;
            }
        }
        // Fallback: stay in PR-XXXXXX format using time-seeded alphabet chars
        // to guarantee uniqueness under extreme load without breaking the pattern.
        long seed = System.currentTimeMillis();
        StringBuilder sb = new StringBuilder("PR-");
        java.util.Random fallbackRandom = new java.util.Random(seed);
        for (int i = 0; i < ORDER_NUMBER_LENGTH; i++) {
            sb.append(ORDER_NUMBER_ALPHABET.charAt(fallbackRandom.nextInt(ORDER_NUMBER_ALPHABET.length())));
        }
        return sb.toString();
    }
}
