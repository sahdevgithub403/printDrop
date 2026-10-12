import { prisma } from "@printdrop/db";
import type { PaymentStore } from "@printdrop/domain";
import { readOrderGraphTx } from "./orderStore.js";

// Prisma-backed payment store. FAILED persistence commits immediately
// (noRollbackFor semantics); verified/webhook flows run in transactions.

export const prismaPaymentStore: PaymentStore = {
  async findOrderById(orderId: string) {
    const order = await prisma.printOrder.findUnique({ where: { id: orderId } });
    if (order == null) {
      return null;
    }
    return {
      id: order.id,
      shopId: order.shopId,
      orderNumber: order.orderNumber,
      totalPrice: order.totalPrice.toString(),
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      razorpayOrderId: order.razorpayOrderId,
      razorpayPaymentId: order.razorpayPaymentId,
    };
  },

  async findPaymentByOrderId(orderId: string) {
    const payment = await prisma.payment.findUnique({ where: { orderId } });
    if (payment == null) {
      return null;
    }
    return {
      id: payment.id,
      orderId: payment.orderId,
      transactionId: payment.transactionId,
      amount: payment.amount.toString(),
      paymentMethod: payment.paymentMethod,
      status: payment.status,
    };
  },

  async savePayment(input) {
    const payment = await prisma.payment.upsert({
      where: { orderId: input.orderId },
      create: {
        orderId: input.orderId,
        transactionId: input.transactionId,
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        status: input.status,
        createdAt: new Date(),
      },
      update: {
        transactionId: input.transactionId,
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        status: input.status,
      },
    });
    return {
      id: payment.id,
      orderId: payment.orderId,
      transactionId: payment.transactionId,
      amount: payment.amount.toString(),
      paymentMethod: payment.paymentMethod,
      status: payment.status,
    };
  },

  async applyVerifiedPayment(input) {
    return prisma.$transaction(async (tx) => {
      await tx.printOrder.update({
        where: { id: input.orderId },
        data: {
          paymentStatus: "PAID",
          razorpayPaymentId: input.razorpayPaymentId,
          razorpaySignature: input.razorpaySignature,
        },
      });
      const order = await tx.printOrder.findUnique({
        where: { id: input.orderId },
      });
      const payment = await tx.payment.upsert({
        where: { orderId: input.orderId },
        create: {
          orderId: input.orderId,
          transactionId: input.razorpayPaymentId,
          amount: order!.totalPrice,
          paymentMethod: "ONLINE",
          status: "PAID",
          createdAt: new Date(),
        },
        update: {
          transactionId: input.razorpayPaymentId,
          status: "PAID",
        },
      });
      if (input.ensureJob) {
        const job = await tx.printJob.findUnique({
          where: { orderId: input.orderId },
        });
        if (job == null) {
          await tx.printJob.create({
            data: {
              orderId: input.orderId,
              status: "QUEUED",
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
        }
      }
      const full = await readOrderGraphTx(tx as unknown as typeof prisma, {
        id: input.orderId,
      });
      if (full == null) {
        throw new Error("order vanished during payment verify");
      }
      return {
        payment: {
          id: payment.id,
          orderId: payment.orderId,
          transactionId: payment.transactionId,
          amount: payment.amount.toString(),
          paymentMethod: payment.paymentMethod,
          status: payment.status,
        },
        order: full,
      };
    });
  },

  async applyFailedPayment(orderId: string) {
    // Commits on its own (mirrors noRollbackFor): FAILED persists even
    // though the caller throws right after.
    await prisma.printOrder.update({
      where: { id: orderId },
      data: { paymentStatus: "FAILED" },
    });
    const order = await prisma.printOrder.findUnique({
      where: { id: orderId },
    });
    const payment = await prisma.payment.upsert({
      where: { orderId },
      create: {
        orderId,
        transactionId: null,
        amount: order!.totalPrice,
        paymentMethod: "ONLINE",
        status: "FAILED",
        createdAt: new Date(),
      },
      update: { status: "FAILED" },
    });
    return {
      id: payment.id,
      orderId: payment.orderId,
      transactionId: payment.transactionId,
      amount: payment.amount.toString(),
      paymentMethod: payment.paymentMethod,
      status: payment.status,
    };
  },

  async applyCancelledPayment(orderId: string) {
    const order = await prisma.printOrder.findUnique({ where: { id: orderId } });
    const payment = await prisma.payment.upsert({
      where: { orderId },
      create: {
        orderId,
        transactionId: null,
        amount: order!.totalPrice,
        paymentMethod: order!.paymentMethod,
        status: "FAILED",
        createdAt: new Date(),
      },
      update: { status: "FAILED" },
    });
    await prisma.printOrder.update({
      where: { id: orderId },
      data: { paymentStatus: "FAILED" },
    });
    return {
      id: payment.id,
      orderId: payment.orderId,
      transactionId: payment.transactionId,
      amount: payment.amount.toString(),
      paymentMethod: payment.paymentMethod,
      status: payment.status,
    };
  },

  async applyWebhookPaid(input) {
    await prisma.$transaction(async (tx) => {
      await tx.printOrder.update({
        where: { id: input.orderId },
        data: {
          paymentStatus: "PAID",
          ...(input.razorpayPaymentId != null
            ? { razorpayPaymentId: input.razorpayPaymentId }
            : {}),
        },
      });
      const order = await tx.printOrder.findUnique({
        where: { id: input.orderId },
      });
      const existing = await tx.payment.findUnique({
        where: { orderId: input.orderId },
      });
      if (existing == null) {
        await tx.payment.create({
          data: {
            orderId: input.orderId,
            transactionId: input.razorpayPaymentId,
            amount: order!.totalPrice,
            paymentMethod: "ONLINE",
            status: "PAID",
            createdAt: new Date(),
          },
        });
      } else {
        await tx.payment.update({
          where: { id: existing.id },
          data: {
            status: "PAID",
            ...(input.razorpayPaymentId != null
              ? { transactionId: input.razorpayPaymentId }
              : {}),
          },
        });
      }
      if (input.ensureJob) {
        const job = await tx.printJob.findUnique({
          where: { orderId: input.orderId },
        });
        if (job == null) {
          await tx.printJob.create({
            data: {
              orderId: input.orderId,
              status: "QUEUED",
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
        }
      }
    });
  },

  async applyWebhookFailed(orderId: string) {
    await prisma.printOrder.update({
      where: { id: orderId },
      data: { paymentStatus: "FAILED" },
    });
    const existing = await prisma.payment.findUnique({ where: { orderId } });
    if (existing != null) {
      await prisma.payment.update({
        where: { id: existing.id },
        data: { status: "FAILED" },
      });
    }
  },

  async findOrderByRazorpayOrderId(razorpayOrderId: string) {
    const order = await prisma.printOrder.findUnique({
      where: { razorpayOrderId },
    });
    if (order == null) {
      return null;
    }
    return {
      id: order.id,
      shopId: order.shopId,
      orderNumber: order.orderNumber,
      totalPrice: order.totalPrice.toString(),
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      razorpayOrderId: order.razorpayOrderId,
      razorpayPaymentId: order.razorpayPaymentId,
    };
  },

  async toOrderDTO(orderId: string) {
    const full = await readOrderGraphTx(prisma, { id: orderId });
    if (full == null) {
      throw new Error("order vanished during webhook handling");
    }
    return full;
  },
};
