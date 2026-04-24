import { RequestHandler } from "express";
import mongoose from "mongoose";
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const { syncSalesOrder, syncCancellation } = _require('../tally/sync');
import { OrderHistory, IOrderHistory, IOrder, IOrderItem } from "../models/UpdatedOrderHistory";
import { Product, SubCategory } from "../models/UpdatedProduct";
import User from "../models/User";
import { io } from "../server";
import { sendOneSignalNotification, sendOrderPlacedNotification } from "../utils/sendOneSignalNotification";
import Notification from "../models/Notification";
import { updateDashboardOnOrder } from "../utils/dashboardUtils";
import { ActivityLogger } from "../utils/activityLogger";
// import { saveOrderMessage } from "./orderMessageController";
// import { generateOrderCodes, getInitialsFromName } from "../utils/orderCode";
import { Cart } from "../models/UpdatedCart";
import Dealer from "../models/Dealer";
// import DealerDiscountConfiguration from "../models/DealerDiscountConfiguration";
import { Schedule } from "../models/UpdatedSchedule";

export const addOrder: RequestHandler = async (req, res): Promise<void> => {
  try {
    const dealerId = req.query.dealerId as string;
    const { salesmanId, orderDate, finalAmt, orderNote, items, deliveryAddressIndex } = req.body;

    // Get the authenticated user's ID from the request
    const userId = req.headers.userid as string;
    if (!userId) {
      res.status(401).json({ message: "UserId required in headers" });
      return;
    }

    console.log(`Order being placed - Dealer ID: ${dealerId}, Salesman ID: ${salesmanId}`);

    // Validate ObjectIds
    if (
      !mongoose.Types.ObjectId.isValid(dealerId) ||
      !mongoose.Types.ObjectId.isValid(salesmanId) ||
      !mongoose.Types.ObjectId.isValid(userId)
    ) {
      res.status(400).json({ message: "Invalid dealerId or salesmanId" });
      return;
    }

    // Validate user roles
    const dealer = await User.findById(dealerId);
    const salesman = await User.findById(salesmanId);
    const createdByUser = await User.findById(userId);
    
    if (!dealer || !salesman || !createdByUser) {
      res.status(404).json({ message: "Dealer, salesman, or user not found" });
      return;
    }
    
    if (dealer.role !== 1) {
      res.status(400).json({ message: "dealerId must be a Dealer (role 1)" });
      return;
    }
    
    // Allow salesmanId to be either a salesperson OR the same as dealerId (for dealer self-orders)
    if (salesman.role !== 2 && salesmanId !== dealerId) {
      res.status(400).json({ message: "salesmanId must be a Salesperson (role 2) or match the dealerId for self-orders" });
      return;
    }
    
    if (![0, 1, 2].includes(createdByUser.role)) {
      res.status(400).json({ message: "Orders can only be placed by admins, dealers, or salespersons" });
      return;
    }

    console.log(`User roles - Created by: ${createdByUser.role}, Dealer: ${dealer.role}, Salesman: ${salesman.role}`);

    // Validate items
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ message: "Items are required" });
      return;
    }

    // Validate each item has required fields
    for (const item of items) {
      // Basic required fields for all items
      if (!item.itemId || !item.quantity || !item.scheduleDate || !item.orderCode) {
        res.status(400).json({
          message: "Each item must include itemId, quantity, scheduleDate, and orderCode"
        });
        return;
      }

      // Price is required unless this is a "Refer LP" item
      // Note: 0 is a valid price, so we check for undefined/null specifically
      if (!item.referLP && (item.priceAtTimeOfOrder === undefined || item.priceAtTimeOfOrder === null)) {
        res.status(400).json({
          message: "Each item must include priceAtTimeOfOrder unless referLP is true"
        });
        return;
      }

      if (!mongoose.Types.ObjectId.isValid(item.itemId)) {
        res.status(400).json({ message: `Invalid itemId: ${item.itemId}` });
        return;
      }

      // Validate that the product exists
      const productExists = await Product.findById(item.itemId);
      if (!productExists) {
        res.status(400).json({ message: `Product not found for itemId: ${item.itemId}` });
        return;
      }
      item._productName = productExists.item;       // stash for Tally sync below
      item._gstRate = (productExists as any).gstRate ?? 18; // Fix 4: per-product GST rate
    }

    // Prepare the new order structure
    const newOrder = {
      _id: new mongoose.Types.ObjectId().toString(),
      orderDate: orderDate || new Date(),
      finalAmt,
      orderNote: orderNote || "", // Add order note field
      salesmanId,
      items: items.map((item: any) => {
        // Always generate a proper MongoDB ObjectId for each item (ignore frontend UUIDs)
        const mongoItemId = new mongoose.Types.ObjectId().toString();
        const discountValue = item.schemeDiscountPercentage || 0;
        console.log(`🎯 BACKEND ORDER ITEM - Receiving discount:`, {
          itemId: item.itemId,
          schemeDiscountPercentage: discountValue,
          referLP: item.referLP,
          priceAtTimeOfOrder: item.priceAtTimeOfOrder
        });
        return {
          _id: mongoItemId,
          itemId: new mongoose.Types.ObjectId(item.itemId),
          quantity: item.quantity,
          priceAtTimeOfOrder: item.priceAtTimeOfOrder,
          scheduleDate: new Date(item.scheduleDate),
          shipmentStatus: item.shipmentStatus || "Pending",
          orderCode: item.orderCode,
          referLP: item.referLP || false, // Add "Refer Latest Price" flag
          shippingChargeType: item.shippingChargeType || "To Pay",
          shippingChargeAmount: item.shippingChargeAmount || 0,
          deliveryPartner: item.deliveryPartner || "",
          schemeDiscountPercentage: discountValue, // Store individual discount from cart
        };
      }),
      deliveryAddressIndex: deliveryAddressIndex !== undefined ? deliveryAddressIndex : 0,
    };

    // Always create a new OrderHistory document (one document per order for scalability)
    const newOrderHistory = new OrderHistory({
      dealerId,
      orders: [newOrder], // Single order per document
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const orderHistory = await newOrderHistory.save();

    // Fire-and-forget: sync to Tally (non-blocking, queued with retry)
    syncSalesOrder({
      orderDate: newOrder.orderDate,
      customerName: (dealer as any).name,
      items: newOrder.items.map((i: any, idx: number) => ({
        name: items[idx]._productName || String(i.itemId),
        qty: i.quantity,
        rate: i.priceAtTimeOfOrder,
        gstRate: items[idx]._gstRate ?? 18, // Fix 4: per-product GST rate
      })),
      refId: String(orderHistory._id),
    }).catch((err: Error) => console.error('[Tally] syncSalesOrder failed:', err.message));

    // Fix 9: Immediately deduct stock so OPS shows accurate qty without waiting 30 min cron.
    (async () => {
      for (const i of newOrder.items as any[]) {
        try {
          await Product.findByIdAndUpdate(i.itemId, { $inc: { stockqty: -i.quantity } });
        } catch {}
      }
    })();

    // Send notification
    try {
      console.log(`Order placed by user with role ${createdByUser.role}. Dealer ID: ${dealerId}, Salesman ID: ${salesmanId}`);

      // For dealer self-orders, ensure we're using the correct salesmanId
      const effectiveSalesmanId = createdByUser.role === 1 && salesmanId === dealerId ?
        // Find a salesman associated with this dealer or use a default
        await User.findOne({ role: 2 }).then(user => user?._id.toString()) || salesmanId :
        salesmanId;

      await sendOrderPlacedNotification({
        userId,
        dealerId,
        salesmanId: effectiveSalesmanId,
        orderCodes: items.map(item => item.orderCode),
        totalAmount: finalAmt,
        itemCount: items.length,
        additionalData: {
          orderId: newOrder._id,
          placedBy: createdByUser.role === 0 ? "Admin" : (createdByUser.role === 2 ? "Salesman" : "Dealer"),
          orderHistory: {
            id: orderHistory._id,
            totalOrders: 1,
          },
        },
      });
    } catch (notifError) {
      console.error("Failed to send order notifications:", notifError);
    }

    // Emit socket event to notify admin users
    io.to("admin_room").emit("new_order", { orderHistory, newOrder });

    // Update dealer dashboard with new order data
    try {
      await updateDashboardOnOrder({
        dealerId: new mongoose.Types.ObjectId(dealerId),
        orderDate: new Date(orderDate || Date.now()),
        finalAmt: finalAmt,
        items: items.map((item: any) => ({
          itemId: new mongoose.Types.ObjectId(item.itemId),
          quantity: item.quantity,
          orderCode: item.orderCode,
        })),
      });
      console.log(`Dashboard updated for dealer ${dealerId} after order creation`);
    } catch (dashboardError) {
      console.error("Failed to update dashboard after order creation:", dashboardError);
      // Don't fail the order creation if dashboard update fails
    }

    // Log order placement activity
    try {
      await ActivityLogger.logOrderEvent(
        req,
        userId,
        'ORDER_PLACED',
        newOrder._id,
        {
          orderAmount: finalAmt,
          orderItems: items.length,
          dealerId,
          salesmanId
        }
      );
    } catch (logError) {
      console.error('Failed to log order placement:', logError);
    }

    res.status(201).json({
      message: "Order created successfully",
      data: orderHistory,
    });
  } catch (error) {
    console.error("Error in addOrder:", error);
    res.status(500).json({
      message: "Error adding order",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const getOrder: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { dealerId } = req.query;

    if (!dealerId || typeof dealerId !== "string" || !mongoose.Types.ObjectId.isValid(dealerId)) {
      res.status(400).json({ message: "Invalid dealerId" });
      return;
    }

    const orderHistory = await OrderHistory.find({ dealerId })
      .populate('dealerId')
      .populate('orders.salesmanId')
      .populate({
        path: 'orders.items.itemId',
        model: 'Product',
        populate: [
          { path: 'brand', model: 'Brand' },
          { path: 'category', model: 'Category' },
          { path: 'subcategory', model: 'SubCategory' }
        ]
      })
      .sort({ createdAt: -1 });

    if (!orderHistory || orderHistory.length === 0) {
      res.status(404).json({ message: "No order history found for this dealer" });
      return;
    }

    res.status(200).json({ message: "Order history fetched successfully", data: orderHistory });
  } catch (error) {
    res.status(500).json({
      message: "Error fetching order history",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const updateOrder: RequestHandler = async (req, res): Promise<void> => {
  try {
    const {
      historyId,
      orderId,
      itemId,
      quantity,
      priceAtTimeOfOrder,
      scheduleDate,
      shipmentStatus,
      orderCode,
      priority,
      newProductId, // Allow changing the product
      newFinalAmount, // Allow changing the order total
    } = req.body;

    // Get the authenticated user's ID from the request
    const userId = req.headers.userid as string;
    if (!userId) {
      res.status(401).json({ message: "UserId required in headers" });
      return;
    }

    // Validate required fields
    if (
      !mongoose.Types.ObjectId.isValid(historyId) ||
      typeof orderId !== 'string' ||
      typeof itemId !== 'string'
    ) {
      console.error('❌ BACKEND VALIDATION ERROR - Invalid input data:', {
        historyId: historyId + ' (valid: ' + mongoose.Types.ObjectId.isValid(historyId) + ')',
        orderId: orderId + ' (type: ' + typeof orderId + ')',
        itemId: itemId + ' (type: ' + typeof itemId + ')'
      });
      res.status(400).json({ message: 'Invalid input data' });
      return;
    }

    const allowedPriorities = ["Urgent", "High", "Medium", "Low"]; 
    if (priority !== undefined && !allowedPriorities.includes(priority)) {
      res.status(400).json({ message: "Invalid priority. Allowed: Urgent, High, Medium, Low" });
      return;
    }

    // Validate new product ID if provided
    if (newProductId && !mongoose.Types.ObjectId.isValid(newProductId)) {
      res.status(400).json({ message: "Invalid newProductId" });
      return;
    }

    // Check if user is admin
    const admin = await User.findById(userId);
    if (!admin || admin.role !== 0) {
      res.status(403).json({ message: "Only admins can update orders" });
      return;
    }

    // Find the OrderHistory document containing this order
    // Since each document now has only 1 order, we search by order ID
    const orderHistory = await OrderHistory.findOne({
      "orders._id": orderId
    });

    if (!orderHistory) {
      res.status(404).json({ message: 'Order not found' });
      return;
    }

    // Get the order (always the first and only order in the array)
    const order = orderHistory.orders[0];
    if (!order) {
      res.status(404).json({ message: 'Order data is invalid' });
      return;
    }

    const item = order.items.find((it: any) => it._id === itemId);
    if (!item) {
      res.status(404).json({ message: 'Order item not found' });
      return;
    }

    // Store original values for activity logging
    const originalItem = {
      itemId: item.itemId,
      quantity: item.quantity,
      priceAtTimeOfOrder: item.priceAtTimeOfOrder,
      scheduleDate: item.scheduleDate,
      shipmentStatus: item.shipmentStatus,
      orderCode: item.orderCode
    };
    const originalOrder = {
      finalAmt: order.finalAmt,
      priority: (order as any).priority
    };
    const previousStatus = item.shipmentStatus; // Store for notifications

    // Update item fields if provided
    if (quantity !== undefined) {
      item.quantity = quantity;
    }
    if (priceAtTimeOfOrder !== undefined) {
      item.priceAtTimeOfOrder = priceAtTimeOfOrder;
    }
    if (scheduleDate !== undefined) {
      item.scheduleDate = new Date(scheduleDate);
    }
    if (shipmentStatus !== undefined) {
      item.shipmentStatus = shipmentStatus;
    }
    if (orderCode !== undefined) {
      item.orderCode = orderCode;
    }
    if (newProductId !== undefined) {
      // Validate that the new product exists
      const productExists = await Product.findById(newProductId);
      if (!productExists) {
        res.status(400).json({ message: `Product not found for newProductId: ${newProductId}` });
        return;
      }
      item.itemId = new mongoose.Types.ObjectId(newProductId);
    }

    // Calculate new order total based on all items
    let calculatedTotal = 0;
    let isAutoCalculated = false;
    
    // Calculate total from all items in the order
    for (const orderItem of order.items) {
      const itemTotal = orderItem.quantity * (orderItem.priceAtTimeOfOrder || 0);
      calculatedTotal += itemTotal;
    }
    
    // Determine if we should use calculated total or admin override
    if (newFinalAmount !== undefined) {
      // Admin explicitly set a new total - use override
      order.finalAmt = newFinalAmount;
      console.log(`💰 Order total OVERRIDDEN by admin: ₹${newFinalAmount} (calculated would be: ₹${calculatedTotal})`);
    } else if (quantity !== undefined || priceAtTimeOfOrder !== undefined) {
      // Quantity or price changed - auto-calculate new total
      order.finalAmt = calculatedTotal;
      isAutoCalculated = true;
      console.log(`💰 Order total AUTO-CALCULATED: ₹${calculatedTotal} (was: ₹${originalOrder.finalAmt})`);
    }
    
    // Update priority if provided
    if (priority !== undefined) {
      (order as any).priority = priority;
    }

    orderHistory.updatedAt = new Date();

    await orderHistory.save();

    // Tally sync on status transitions (fire-and-forget)
    if (shipmentStatus && previousStatus !== shipmentStatus) {
      (async () => {
        try {
          const dealer = await User.findById(orderHistory.dealerId).lean() as any;
          const productIds = order.items.map((i: any) => i.itemId);
          // Fix 4: fetch gstRate alongside item name
          const products = await Product.find({ _id: { $in: productIds } }, 'item gstRate').lean() as any[];
          const productMap = Object.fromEntries(products.map((p: any) => [String(p._id), p]));
          const mappedItems = order.items.map((i: any) => ({
            name: productMap[String(i.itemId)]?.item ?? String(i.itemId),
            qty: i.quantity,
            rate: i.priceAtTimeOfOrder ?? 0,
            gstRate: productMap[String(i.itemId)]?.gstRate ?? 18, // Fix 4
          }));

          if (shipmentStatus === 'InTransit') {
            await syncSalesOrder({
              orderDate: new Date(),
              customerName: dealer?.name ?? 'Unknown',
              items: mappedItems,
              refId: `inv-${orderId}`,
            });
          }

          // Fix 5: push Credit Note to Tally when order is cancelled
          if (shipmentStatus === 'Cancelled') {
            await syncCancellation({
              orderDate: new Date(),
              customerName: dealer?.name ?? 'Unknown',
              items: mappedItems,
              refId: `cancel-${orderId}`,
            });
          }
        } catch (e: any) {
          console.error('[Tally] Status transition sync failed:', e.message);
        }
      })();
    }

    // Comprehensive activity logging for admin order modifications
    try {
      const changes: string[] = [];
      const beforeData: any = {};
      const afterData: any = {};

      // Track item changes
      if (quantity !== undefined && quantity !== originalItem.quantity) {
        changes.push(`Quantity: ${originalItem.quantity} → ${quantity}`);
        beforeData.quantity = originalItem.quantity;
        afterData.quantity = quantity;
      }
      if (priceAtTimeOfOrder !== undefined && priceAtTimeOfOrder !== originalItem.priceAtTimeOfOrder) {
        changes.push(`Price: ₹${originalItem.priceAtTimeOfOrder} → ₹${priceAtTimeOfOrder}`);
        beforeData.priceAtTimeOfOrder = originalItem.priceAtTimeOfOrder;
        afterData.priceAtTimeOfOrder = priceAtTimeOfOrder;
      }
      if (scheduleDate !== undefined) {
        const newMs = new Date(scheduleDate).getTime();
        const origMs = originalItem.scheduleDate ? new Date(originalItem.scheduleDate).getTime() : null;
        if (origMs === null || newMs !== origMs) {
          changes.push(`Schedule: ${originalItem.scheduleDate ? new Date(originalItem.scheduleDate).toISOString() : 'N/A'} → ${scheduleDate}`);
          beforeData.scheduleDate = originalItem.scheduleDate || null;
          afterData.scheduleDate = new Date(scheduleDate);
        }
      }
      if (shipmentStatus !== undefined && shipmentStatus !== originalItem.shipmentStatus) {
        changes.push(`Status: ${originalItem.shipmentStatus} → ${shipmentStatus}`);
        beforeData.shipmentStatus = originalItem.shipmentStatus;
        afterData.shipmentStatus = shipmentStatus;
      }
      if (orderCode !== undefined && orderCode !== originalItem.orderCode) {
        changes.push(`Order Code: ${originalItem.orderCode} → ${orderCode}`);
        beforeData.orderCode = originalItem.orderCode;
        afterData.orderCode = orderCode;
      }
      if (newProductId !== undefined && newProductId.toString() !== originalItem.itemId.toString()) {
        changes.push(`Product: ${originalItem.itemId} → ${newProductId}`);
        beforeData.itemId = originalItem.itemId;
        afterData.itemId = newProductId;
      }

      // Track order-level changes
      if (order.finalAmt !== originalOrder.finalAmt) {
        if (newFinalAmount !== undefined) {
          // Manual override by admin
          changes.push(`Order Total: ₹${originalOrder.finalAmt} → ₹${newFinalAmount} (ADMIN OVERRIDE)`);
        } else if (isAutoCalculated) {
          // Auto-calculated due to qty/price changes
          changes.push(`Order Total: ₹${originalOrder.finalAmt} → ₹${order.finalAmt} (AUTO-CALCULATED)`);
        }
        beforeData.finalAmt = originalOrder.finalAmt;
        afterData.finalAmt = order.finalAmt;
      }
      if (priority !== undefined && priority !== originalOrder.priority) {
        changes.push(`Priority: ${originalOrder.priority || 'N/A'} → ${priority}`);
        beforeData.priority = originalOrder.priority;
        afterData.priority = priority;
      }

      // Log the activity
      if (changes.length > 0) {
        const action = shipmentStatus === 'Delivered' ? 'ORDER_DELIVERED' : 
                      shipmentStatus === 'Cancelled' ? 'ORDER_CANCELLED' : 'ORDER_MODIFIED';
        
        const orderEventPayload: any = {
          fromStatus: originalItem.shipmentStatus,
          toStatus: shipmentStatus || originalItem.shipmentStatus,
          dealerId: orderHistory.dealerId.toString(),
          salesmanId: order.salesmanId as any,
          changes: changes,
          itemId: itemId
        };

        await ActivityLogger.logOrderEvent(
          req,
          userId,
          action,
          orderId,
          orderEventPayload
        );

        // Also log as a general activity for comprehensive tracking
        const activityMeta: any = {
          beforeData,
          afterData,
          metadata: {
            orderId,
            historyId,
            itemId,
            changesCount: changes.length,
            adminAction: 'modify_order_item',
            modifiedFields: Object.keys(afterData),
            dealerId: orderHistory.dealerId.toString(),
            salesmanId: order.salesmanId?.toString(),
            timestamp: new Date().toISOString(),
            adminUserId: userId,
            changesSummary: changes,
            orderCode: item.orderCode || 'N/A',
            productChanged: newProductId !== undefined,
            priceOverride: priceAtTimeOfOrder !== undefined && priceAtTimeOfOrder !== originalItem.priceAtTimeOfOrder,
            totalAmountChanged: order.finalAmt !== originalOrder.finalAmt,
            totalAmountOverridden: newFinalAmount !== undefined,
            totalAmountAutoCalculated: isAutoCalculated,
            calculatedTotal: calculatedTotal,
            scheduleChanged: scheduleDate !== undefined && scheduleDate !== originalItem.scheduleDate?.toISOString(),
            priorityChanged: priority !== undefined && priority !== originalOrder.priority
          }
        };

        await ActivityLogger.logActivity(
          { userId },
          {
            ipAddress: (req.headers['x-real-ip'] as string) || req.ip || 'unknown',
            userAgent: String(req.headers['user-agent'] || ''),
            requestPath: req.path,
            requestMethod: req.method
          },
          {
            action: 'ADMIN_ORDER_MODIFICATION',
            actionDescription: `Admin modified order item: ${changes.join(', ')}`,
            entityType: 'order',
            entityId: orderId,
            entityName: `Order ${orderId}`,
            category: 'order_management',
            severity: 'high',
            isSuccessful: true,
            requiresAttention: true
          },
          activityMeta as any
        );
      }
    } catch (logError) {
      console.error('Failed to log order modification:', logError);
    }

    try {
      const code = orderCode || item.orderCode || '';
      io.to("admin_room").emit("order_updated", {
        orderHistory,
        updatedItem: { historyId, orderId, itemId, shipmentStatus: shipmentStatus || previousStatus },
        orderCode: code
      });
    } catch (err) {
      console.warn('Failed to send admin SSE for order update', err);
    }

    if (
      previousStatus !== shipmentStatus &&
      shipmentStatus !== undefined &&
      ["InProcessing", "InPackaging", "InTransit", "Delivered", "Cancelled"].includes(shipmentStatus)
    ) {
      try {
        const orderCodeToUse = orderCode || item.orderCode || '';
        // Check if we've already sent a notification for this order code in the last minute
        const recentNotification = await Notification.findOne({
          orderCode: orderCodeToUse,
          status: shipmentStatus,
          createdAt: { $gte: new Date(Date.now() - 60000) } // Within the last minute
        });

        if (recentNotification) {
          console.log(`Skipping duplicate notification for order ${orderCodeToUse} with status ${shipmentStatus} - already sent recently`);
        } else {
          // Since OrderHistory lacks createdBy, assume salesmanId for salesperson-placed orders
          const salesman = await User.findById(order.salesmanId);
          if (!salesman || salesman.role !== 2) {
            throw new Error("Invalid salesman for order");
          }
          const userIds = [orderHistory.dealerId.toString(), salesman._id.toString()]; // Notify both

          await sendOneSignalNotification({
            userIds,
            dealerId: orderHistory.dealerId.toString(),
            orderCode: orderCodeToUse,
            shipmentStatus,
            additionalData: {
              updatedBy: userId,
              type: "order_status_changed",
            },
          });
          console.log(`Notifications sent for order ${orderCodeToUse}`);
        }
      } catch (err) {
        console.error("Failed to send status update notifications:", err);
      }
    }

    res.status(200).json({ message: 'Order item updated successfully', data: orderHistory });
  } catch (error) {
    res.status(500).json({
      message: 'Error updating order item',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const getAllOrderHistory: RequestHandler = async (req, res): Promise<void> => {
  try {
    // Extract query parameters for filtering and pagination
    const {
      page = 1,
      limit = 50,
      status,
      dealerId,
      salesmanId,
      search,
      priority,
      deliveryType,
      startDate,
      endDate,
      sortField = 'updatedAt',
      sortDirection = 'desc'
    } = req.query;

    // Build filter query
    const filter: any = {};

    // Filter by dealerId if provided
    if (dealerId && typeof dealerId === 'string') {
      if (mongoose.Types.ObjectId.isValid(dealerId)) {
        filter.dealerId = new mongoose.Types.ObjectId(dealerId);
      }
    }

    // Filter by salesmanId if provided (within orders array)
    if (salesmanId && typeof salesmanId === 'string') {
      if (mongoose.Types.ObjectId.isValid(salesmanId)) {
        filter['orders.salesmanId'] = new mongoose.Types.ObjectId(salesmanId);
      }
    }

    // Filter by status (within orders.items array)
    if (status && typeof status === 'string' && status !== 'all') {
      filter['orders.items.shipmentStatus'] = status;
    }

    // Filter by priority (within orders array)
    if (priority && typeof priority === 'string' && priority !== 'all') {
      filter['orders.priority'] = priority;
    }

    // Filter by deliveryType (within orders array)
    if (deliveryType && typeof deliveryType === 'string' && deliveryType !== 'all') {
      filter['orders.deliveryType'] = deliveryType;
    }

    // Filter by date range
    if (startDate || endDate) {
      filter['orders.orderDate'] = {};
      if (startDate && typeof startDate === 'string') {
        filter['orders.orderDate'].$gte = new Date(startDate);
      }
      if (endDate && typeof endDate === 'string') {
        filter['orders.orderDate'].$lte = new Date(endDate);
      }
    }

    // Search functionality (search in dealer name, order codes, etc.)
    if (search && typeof search === 'string' && search.trim()) {
      // We'll handle search after populating since we need to search populated fields
      // For now, just mark that we have a search term
    }

    // Calculate pagination
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    // Build sort object
    const sort: any = {};
    const sortFieldStr = typeof sortField === 'string' ? sortField : 'updatedAt';
    const sortDir = sortDirection === 'asc' ? 1 : -1;
    sort[sortFieldStr] = sortDir;

    console.log('🔍 FILTER DEBUG - Query params:', { page, limit, status, dealerId, salesmanId, search, priority, deliveryType, startDate, endDate });
    console.log('🔍 FILTER DEBUG - Built filter:', JSON.stringify(filter));

    // Execute query with pagination
    const [orderHistories, totalCount] = await Promise.all([
      OrderHistory.find(filter)
        .populate('dealerId')
        .populate('orders.salesmanId')
        .populate({
          path: 'orders.items.itemId',
          model: 'Product',
          populate: [
            { path: 'brand', model: 'Brand' },
            { path: 'category', model: 'Category' },
            { path: 'subcategory', model: 'SubCategory' }
          ]
        })
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .exec(),
      OrderHistory.countDocuments(filter)
    ]);

    // Apply search filter if provided (after population)
    let filteredHistories = orderHistories;
    if (search && typeof search === 'string' && search.trim()) {
      const searchLower = search.toLowerCase();
      filteredHistories = orderHistories.filter((history: any) => {
        // Search in dealer name
        const dealerName = history.dealerId?.dealer_name?.toLowerCase() || '';
        if (dealerName.includes(searchLower)) return true;

        // Search in order codes
        const hasMatchingOrderCode = history.orders.some((order: any) => 
          order.items.some((item: any) => 
            item.orderCode?.toLowerCase().includes(searchLower)
          )
        );
        if (hasMatchingOrderCode) return true;

        // Search in product names
        const hasMatchingProduct = history.orders.some((order: any) =>
          order.items.some((item: any) =>
            item.itemId?.product_name?.toLowerCase().includes(searchLower)
          )
        );
        if (hasMatchingProduct) return true;

        return false;
      });
    }

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limitNum);
    const hasMore = pageNum < totalPages;

    // Return empty array if no results
    if (!filteredHistories || filteredHistories.length === 0) {
      res.status(200).json({
        message: "No order history found",
        data: [],
        pagination: {
          total: 0,
          page: pageNum,
          limit: limitNum,
          totalPages: 0,
          hasMore: false
        }
      });
      return;
    }

    res.status(200).json({
      message: "Order history fetched successfully",
      data: filteredHistories,
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages,
        hasMore
      }
    });
  } catch (error) {
    console.error('❌ ERROR fetching order history:', error);
    res.status(500).json({
      message: "Error fetching order history",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Create Order from Schedule Controller (New function)
export const createOrderFromSchedule: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { dealerId, salesmanId, scheduleId, orderId, finalAmt, orderNote, deliveryAddressIndex } = req.body;

    // Get the authenticated user's ID from the request
    const userId = req.headers.userid as string;
    if (!userId) {
      res.status(401).json({ message: "UserId required in headers" });
      return;
    }

    // Validate required fields
    if (!dealerId || !salesmanId || !scheduleId || !orderId || typeof finalAmt !== 'number') {
      res.status(400).json({ message: "dealerId, salesmanId, scheduleId, orderId, and finalAmt are required" });
      return;
    }

    // Validate ObjectIds
    if (!mongoose.Types.ObjectId.isValid(dealerId) || 
        !mongoose.Types.ObjectId.isValid(salesmanId) || 
        !mongoose.Types.ObjectId.isValid(scheduleId)) {
      res.status(400).json({ message: "Invalid dealerId, salesmanId, or scheduleId" });
      return;
    }

    // Import Schedule here to avoid circular dependencies
    const { Schedule } = await import("../models/UpdatedSchedule");
    
    // Find the schedule
    const schedule = await Schedule.findById(scheduleId);
    if (!schedule) {
      res.status(404).json({ message: "Schedule not found" });
      return;
    }

    if (schedule.dealerId.toString() !== dealerId) {
      res.status(400).json({ message: "Schedule does not belong to the specified dealer" });
      return;
    }

    // Find the specific order in the schedule
    const scheduleOrder = schedule.orders.find((order: any) => order._id === orderId);
    if (!scheduleOrder) {
      res.status(404).json({ message: "Order not found in schedule" });
      return;
    }

    if (!scheduleOrder.items || scheduleOrder.items.length === 0) {
      res.status(400).json({ message: "Schedule order has no items" });
      return;
    }

    // Convert schedule items to order items
    const orderItems = scheduleOrder.items.map((scheduleItem: any) => ({
      _id: new mongoose.Types.ObjectId().toString(),
      itemId: scheduleItem.itemId,
      quantity: scheduleItem.quantity,
      priceAtTimeOfOrder: scheduleItem.priceAtTimeOfSchedule || 0,
      scheduleDate: scheduleItem.scheduledDate,
      shipmentStatus: "Pending",
      orderCode: `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
    }));

    // Create new order
    const newOrder = {
      _id: new mongoose.Types.ObjectId().toString(),
      orderDate: new Date(),
      finalAmt,
      orderNote: orderNote || "", // Add order note field
      salesmanId: new mongoose.Types.ObjectId(salesmanId),
      items: orderItems,
      deliveryAddressIndex: deliveryAddressIndex || 0,
    };

    // Find existing order history or create new one
    let orderHistory = await OrderHistory.findOne({ dealerId });

    if (orderHistory) {
      // Add to existing order history
      orderHistory.orders.push(newOrder);
      orderHistory.updatedAt = new Date();
      await orderHistory.save();
      
      res.status(200).json({
        message: "Order created from schedule successfully!",
        data: orderHistory,
        newOrder: newOrder,
        itemsConverted: orderItems.length
      });
    } else {
      // Create new order history
      const newOrderHistory = new OrderHistory({
        dealerId: new mongoose.Types.ObjectId(dealerId),
        orders: [newOrder],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      orderHistory = await newOrderHistory.save();
      
      res.status(201).json({
        message: "Order history created from schedule successfully!",
        data: orderHistory,
        newOrder: newOrder,
        itemsConverted: orderItems.length
      });
    }

  } catch (error) {
    res.status(500).json({
      message: "Error creating order from schedule",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Update Order Note
export const updateOrderNote: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { historyId, orderId, splits, backorderReason } = req.body;
    // splits: Array<{ itemId: string, backorderQuantity: number }>

    // Get the authenticated user's ID from the request
    const userId = req.headers.userid as string;
    if (!userId) {
      res.status(401).json({ message: "UserId required in headers" });
      return;
    }

    // Validate required fields
    if (
      !mongoose.Types.ObjectId.isValid(historyId) ||
      typeof orderId !== 'string' ||
      !Array.isArray(splits) ||
      splits.length === 0
    ) {
      console.error('❌ CREATE BACKORDER - Invalid input data:', {
        historyId: historyId + ' (valid: ' + mongoose.Types.ObjectId.isValid(historyId) + ')',
        orderId: orderId + ' (type: ' + typeof orderId + ')',
        splits: splits + ' (isArray: ' + Array.isArray(splits) + ', length: ' + (Array.isArray(splits) ? splits.length : 0) + ')'
      });
      res.status(400).json({ message: 'Invalid input data - historyId, orderId, and splits array required' });
      return;
    }

    // Validate each split entry
    for (const split of splits) {
      if (!split.itemId || typeof split.backorderQuantity !== 'number' || split.backorderQuantity <= 0) {
        res.status(400).json({
          message: `Invalid split data - each split must have itemId and positive backorderQuantity`
        });
        return;
      }
    }

    // Check if user is admin
    const admin = await User.findById(userId);
    if (!admin || admin.role !== 0) {
      res.status(403).json({ message: "Only admins can create backorders" });
      return;
    }

    // Find the OrderHistory document containing this order
    const orderHistory = await OrderHistory.findOne({
      "orders._id": orderId
    });

    if (!orderHistory) {
      res.status(404).json({ message: 'Order not found' });
      return;
    }

    // Get the original order (always the first and only order in the array)
    const originalOrder = orderHistory.orders[0];
    if (!originalOrder) {
      res.status(404).json({ message: 'Order data is invalid' });
      return;
    }

    // Validate all items exist and quantities are valid
    const backorderItems: any[] = [];
    let originalOrderTotalReduction = 0;
    let backorderTotal = 0;

    for (const split of splits) {
      const itemIndex = originalOrder.items.findIndex((it: any) => it._id === split.itemId);
      if (itemIndex === -1) {
        res.status(404).json({ message: `Item ${split.itemId} not found in order` });
        return;
      }

      const originalItem = originalOrder.items[itemIndex];

      // Validate backorder quantity is not greater than original quantity
      if (split.backorderQuantity > originalItem.quantity) {
        res.status(400).json({
          message: `Backorder quantity (${split.backorderQuantity}) cannot exceed original quantity (${originalItem.quantity}) for item ${split.itemId}`
        });
        return;
      }

      // Validate backorder quantity is greater than 0
      if (split.backorderQuantity <= 0) {
        res.status(400).json({
          message: `Backorder quantity must be greater than 0 for item ${split.itemId}`
        });
        return;
      }

      // Calculate costs
      const itemBackorderCost = originalItem.priceAtTimeOfOrder * split.backorderQuantity;
      originalOrderTotalReduction += itemBackorderCost;
      backorderTotal += itemBackorderCost;

      // Create backorder item
      backorderItems.push({
        _id: new mongoose.Types.ObjectId().toString(),
        itemId: originalItem.itemId,
        quantity: split.backorderQuantity,
        priceAtTimeOfOrder: originalItem.priceAtTimeOfOrder,
        scheduleDate: originalItem.scheduleDate,
        shipmentStatus: "Backorder",
        orderCode: `${originalItem.orderCode}-BO`, // Will be updated with backorder number
      });
    }

    // Calculate backorder number (find highest existing backorder number + 1)
    // Query database since each backorder is now in its own document
    const existingBackorders = await OrderHistory.find({
      "orders.isBackorder": true,
      "orders.parentOrderId": orderId
    });
    const backorderNumber = existingBackorders.length + 1;

    console.log(`📦 CREATE BACKORDER - Creating backorder BO${backorderNumber} from order ${orderId}:`, {
      originalOrderId: orderId,
      splitsCount: splits.length,
      backorderNumber,
      backorderTotal,
      originalOrderTotalReduction
    });

    // Update original order items - reduce quantities and remove items with 0 quantity
    for (const split of splits) {
      const item = originalOrder.items.find((it: any) => it._id === split.itemId);
      if (item) {
        item.quantity -= split.backorderQuantity;
      }
    }

    // Remove items with 0 quantity (entire product moved to backorder)
    originalOrder.items = originalOrder.items.filter((item: any) => item.quantity > 0);

    // Update original order total
    originalOrder.finalAmt -= originalOrderTotalReduction;

    // Create new backorder order
    const backorderOrder = {
      _id: new mongoose.Types.ObjectId().toString(),
      orderDate: originalOrder.orderDate,
      finalAmt: backorderTotal,
      salesmanId: originalOrder.salesmanId,
      items: backorderItems,
      deliveryAddressIndex: originalOrder.deliveryAddressIndex,
      deliveryType: originalOrder.deliveryType,
      onsiteDeliveryAddress: originalOrder.onsiteDeliveryAddress,
      priority: originalOrder.priority,
      // Backorder specific fields
      isBackorder: true,
      parentOrderId: orderId,
      backorderNumber: backorderNumber,
      backorderReason: backorderReason || "Stock shortage",
      backorderCreatedDate: new Date(),
    };

    // Save the updated original order (with reduced quantities)
    orderHistory.updatedAt = new Date();
    await orderHistory.save();

    // Create new OrderHistory document for the backorder (one document per order)
    const backorderDoc = new OrderHistory({
      dealerId: orderHistory.dealerId,
      orders: [backorderOrder], // Single backorder in its own document
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await backorderDoc.save();

    // Log the backorder creation activity
    try {
      const itemsSummary = splits.map((s: any) => {
        const item = originalOrder.items.find((it: any) => it._id === s.itemId);
        return `${item?.itemId} (${s.backorderQuantity} units)`;
      }).join(', ');

      const activityMeta: any = {
        beforeData: {
          originalOrderId: orderId,
          originalOrderTotal: originalOrder.finalAmt + originalOrderTotalReduction,
          originalItemsCount: originalOrder.items.length
        },
        afterData: {
          originalOrder: {
            orderId: orderId,
            newTotal: originalOrder.finalAmt,
            itemsCount: originalOrder.items.length
          },
          backorderOrder: {
            backorderId: backorderOrder._id,
            backorderNumber: backorderNumber,
            total: backorderTotal,
            itemsCount: backorderItems.length
          }
        },
        metadata: {
          orderId,
          historyId,
          backorderId: backorderOrder._id,
          backorderNumber,
          splitsCount: splits.length,
          originalOrderTotalReduction,
          backorderTotal,
          backorderReason: backorderReason || "Stock shortage",
          adminUserId: userId,
          timestamp: new Date().toISOString(),
          parentOrderId: orderId,
          splits: splits
        }
      };

      await ActivityLogger.logActivity(
        { userId },
        {
          ipAddress: (req.headers['x-real-ip'] as string) || req.ip || 'unknown',
          userAgent: String(req.headers['user-agent'] || ''),
          requestPath: req.path,
          requestMethod: req.method
        },
        {
          action: 'ORDER_BACKORDER_CREATED',
          actionDescription: `Admin created backorder BO${backorderNumber} from order ${orderId}: ${itemsSummary}`,
          entityType: 'order',
          entityId: backorderOrder._id,
          entityName: `Backorder BO${backorderNumber}`,
          category: 'order_management',
          severity: 'high',
          isSuccessful: true,
          requiresAttention: true
        },
        activityMeta as any
      );
    } catch (logError) {
      console.error('Failed to log backorder creation:', logError);
    }

    try {
      const code = backorderItems && backorderItems[0] && backorderItems[0].orderCode || '';
      sendAdminSse({ type: 'BACKORDER_CREATED', orderCode: code });
    } catch (err) {
      console.warn('Failed to send admin SSE for backorder', err);
    }

    res.status(200).json({
      message: `Backorder BO${backorderNumber} created successfully`,
      data: orderHistory, // Updated original order
      backorderData: backorderDoc, // New backorder document
      backorderInfo: {
        originalOrderId: orderId,
        backorderId: backorderOrder._id,
        backorderDocId: backorderDoc._id,
        backorderNumber,
        originalOrderNewTotal: originalOrder.finalAmt,
        backorderTotal,
        splitsCount: splits.length,
        backorderReason: backorderReason || "Stock shortage"
      }
    });
  } catch (error) {
    console.error('❌ ERROR creating backorder:', error);
    res.status(500).json({
      message: 'Error creating backorder',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Get Review Order with ALL Calculations (Server-Side)
export const getReviewOrderCalculations: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { dealerId, salesmanId, selectedAddressIndex, deliveryType, onsiteAddress } = req.query;

    if (!dealerId || !salesmanId) {
      res.status(400).json({ message: "dealerId and salesmanId are required" });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(dealerId as string) ||
        !mongoose.Types.ObjectId.isValid(salesmanId as string)) {
      res.status(400).json({ message: "Invalid dealerId or salesmanId" });
      return;
    }

    // Fetch cart with populated items
    const cart = await Cart.findOne({
      dealerId: new mongoose.Types.ObjectId(dealerId as string),
      salesmanId: new mongoose.Types.ObjectId(salesmanId as string)
    }).populate({
      path: 'items.itemId',
      populate: {
        path: 'brand category subcategory',
        select: 'brand_name category_name subcategory_name is_scheme_category discountTiers'
      }
    });

    if (!cart || cart.items.length === 0) {
      res.status(200).json({
        message: "Cart is empty",
        cart: {
          _id: cart?._id || null,
          dealerId: dealerId as string,
          salesmanId: salesmanId as string,
          items: [],
        },
        items: [],
        pricing: {
          totalItems: 0,
          subtotal: 0,
          totalSchemeDiscount: 0,
          cashDiscountAmount: 0,
          baseDiscountAmount: 0,
          totalSavings: 0,
          netTotal: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          grandTotal: 0,
          isMaharashtra: false,
        },
        dealer: null,
        schedule: null,
      });
      return;
    }

    // 🎯 DEBUG: Log raw cart items with discount percentages
    console.log('🎯 REVIEW ORDER CALC - Raw cart items:', cart.items.map(item => ({
      itemId: item.itemId,
      quantity: item.quantity,
      discountPercentage: item.discountPercentage,
      referLP: item.referLP,
      priceAtTimeOfAdd: item.priceAtTimeOfAdd
    })));

    // Fetch dealer information
    const dealer = await Dealer.findById(dealerId);
    if (!dealer) {
      res.status(404).json({ message: "Dealer not found" });
      return;
    }

    // Fetch schedule data
    const schedule = await Schedule.findOne({
      dealerId: new mongoose.Types.ObjectId(dealerId as string)
    }).populate('orders.items.itemId');

    // Create a map of itemId to shipping info from schedule
    const shippingInfoMap = new Map<string, { shippingChargeType?: string; shippingChargeAmount?: number; deliveryPartner?: string }>();
    if (schedule && schedule.orders) {
      schedule.orders.forEach((order: any) => {
        order.items.forEach((scheduleItem: any) => {
          const itemIdStr = typeof scheduleItem.itemId === 'string' ? scheduleItem.itemId : scheduleItem.itemId?._id?.toString();
          if (itemIdStr && !shippingInfoMap.has(itemIdStr)) {
            shippingInfoMap.set(itemIdStr, {
              shippingChargeType: scheduleItem.shippingChargeType || "To Pay",
              shippingChargeAmount: scheduleItem.shippingChargeAmount || 0,
              deliveryPartner: scheduleItem.deliveryPartner || ""
            });
          }
        });
      });
    }

    // Get unique subcategory names from cart items
    const uniqueSubcategoryNames = Array.from(
      new Set(
        cart.items
          .map(item => (item.itemId as any)?.subcategory?.subcategory_name)
          .filter(Boolean)
      )
    );

    // Fetch subcategories with discount tiers (only for cart items)
    const subcategories = await SubCategory.find({
      subcategory_name: { $in: uniqueSubcategoryNames }
    }).select('subcategory_name is_scheme_category discountTiers');

    // Build a map for quick lookup
    const subcategoryMap = new Map(
      subcategories.map(sub => [sub.subcategory_name, sub])
    );

    // Calculate subcategory totals (quantity and order value per subcategory)
    const subcategoryTotals: Record<string, { quantity: number; orderValue: number }> = {};

    cart.items.forEach(item => {
      const subcategoryName = (item.itemId as any)?.subcategory?.subcategory_name || 'unknown';
      const itemPrice = item.priceAtTimeOfAdd || (item.itemId as any)?.price || 0;
      const itemTotal = itemPrice * item.quantity;

      if (!subcategoryTotals[subcategoryName]) {
        subcategoryTotals[subcategoryName] = { quantity: 0, orderValue: 0 };
      }
      subcategoryTotals[subcategoryName].quantity += item.quantity;
      subcategoryTotals[subcategoryName].orderValue += itemTotal;
    });

    // Function to calculate subcategory discount
    const calculateSubcategoryDiscount = (
      subcategoryName: string,
      quantity: number,
      orderValue: number
    ): number => {
      if (subcategoryName === 'unknown') return 0;

      const subcategory = subcategoryMap.get(subcategoryName);
      if (!subcategory || !subcategory.is_scheme_category || !subcategory.discountTiers || subcategory.discountTiers.length === 0) {
        return 0;
      }

      const discountTiers = subcategory.discountTiers;

      // Split tiers by type
      const quantityTiers = discountTiers
        .filter(tier => tier.type === 'quantity' || (tier as any).quantity !== undefined)
        .sort((a, b) => {
          const aValue = a.type === 'quantity' ? a.value : ((a as any).quantity || 0);
          const bValue = b.type === 'quantity' ? b.value : ((b as any).quantity || 0);
          return aValue - bValue;
        });

      const orderValueTiers = discountTiers
        .filter(tier => tier.type === 'order_value')
        .sort((a, b) => a.value - b.value);

      let currentDiscount = 0;

      // Check quantity-based tiers
      for (const tier of quantityTiers) {
        const tierQuantity = tier.type === 'quantity' ? tier.value : ((tier as any).quantity || 0);
        if (quantity >= tierQuantity) {
          currentDiscount = Math.max(currentDiscount, tier.discount);
        }
      }

      // Check order value-based tiers
      for (const tier of orderValueTiers) {
        if (orderValue >= tier.value) {
          currentDiscount = Math.max(currentDiscount, tier.discount);
        }
      }

      return currentDiscount;
    };

    // Calculate enhanced cart items with discount information
    const enhancedItems = cart.items.map(item => {
      const subcategoryName = (item.itemId as any)?.subcategory?.subcategory_name || 'unknown';
      const subcategoryData = subcategoryTotals[subcategoryName] || { quantity: 0, orderValue: 0 };
      const subcategoryDiscount = calculateSubcategoryDiscount(
        subcategoryName,
        subcategoryData.quantity,
        subcategoryData.orderValue
      );

      // Use individual item discount percentage (primary), fallback to subcategory discount
      const individualDiscount = item.discountPercentage || 0;
      const effectiveDiscount = individualDiscount > 0 ? individualDiscount : subcategoryDiscount;

      const itemPrice = item.priceAtTimeOfAdd || (item.itemId as any)?.price || 0;
      const discountAmount = (itemPrice * effectiveDiscount) / 100;
      const discountedPrice = itemPrice - discountAmount;

      // Cash and base discount calculations
      const cashDiscountPercentage = dealer.dealer_cashDiscount || 0;
      const baseDiscountPercentage = dealer.dealer_baseDiscount || 0;
      const cashDiscountAmount = (discountedPrice * cashDiscountPercentage) / 100;
      const baseDiscountAmount = (discountedPrice * baseDiscountPercentage) / 100;
      const finalPrice = discountedPrice - cashDiscountAmount - baseDiscountAmount;

      // Get shipping info for this item from schedule
      const itemIdStr = (item.itemId as any)._id.toString();
      const shippingInfo = shippingInfoMap.get(itemIdStr) || {};

      return {
        _id: item._id,
        productId: (item.itemId as any)._id,
        productName: (item.itemId as any).item,
        itemCode: (item.itemId as any).item,
        quantity: item.quantity,
        unitPrice: itemPrice,
        discountPercentage: item.discountPercentage, // Include individual discount for reference
        schemeDiscountPercentage: item.discountPercentage || 0, // Map to schemeDiscountPercentage for order storage
        total: finalPrice * item.quantity,
        originalTotal: itemPrice * item.quantity,
        savings: discountAmount * item.quantity,
        cashDiscount: cashDiscountAmount * item.quantity,
        baseDiscount: baseDiscountAmount * item.quantity,
        finish: (item.itemId as any).brand?.brand_name || "",
        pcsPerSet: 1,
        missingDiscount: subcategoryName === 'unknown',
        referLP: item.referLP || false, // Add "Refer Latest Price" flag
        // Shipping and delivery fields from schedule
        shippingChargeType: shippingInfo.shippingChargeType,
        shippingChargeAmount: shippingInfo.shippingChargeAmount,
        deliveryPartner: shippingInfo.deliveryPartner,
      };
    });

    // Calculate pricing totals
    const subtotal = enhancedItems.reduce((sum, item) => sum + (item.originalTotal || 0), 0);
    const totalSchemeDiscount = enhancedItems.reduce((sum, item) => sum + (item.savings || 0), 0);
    const totalCashDiscount = enhancedItems.reduce((sum, item) => sum + (item.cashDiscount || 0), 0);
    const totalBaseDiscount = enhancedItems.reduce((sum, item) => sum + (item.baseDiscount || 0), 0);
    const totalSavings = totalSchemeDiscount + totalCashDiscount + totalBaseDiscount;
    const netTotal = subtotal - totalSavings;
    const totalItems = enhancedItems.reduce((sum, item) => sum + item.quantity, 0);

    // Calculate shipping charges
    const totalShippingChargesCustomer = enhancedItems.reduce((sum, item) => {
      return sum + (item.shippingChargeType === "Paid" ? (item.shippingChargeAmount || 0) : 0);
    }, 0);
    const totalShippingChargesCompany = enhancedItems.reduce((sum, item) => {
      return sum + (item.shippingChargeType === "To Pay" ? (item.shippingChargeAmount || 0) : 0);
    }, 0);

    // Tax calculation based on delivery type and address
    let isMaharashtra = false;
    if (deliveryType === "warehouse_pickup") {
      isMaharashtra = true;
    } else if (deliveryType === "onsite_delivery" && onsiteAddress) {
      try {
        const parsedAddress = JSON.parse(onsiteAddress as string);
        isMaharashtra = parsedAddress.state === "Maharashtra";
      } catch {
        isMaharashtra = false;
      }
    } else {
      // Standard delivery - use selected address index
      const addressIdx = parseInt(selectedAddressIndex as string || "0");
      isMaharashtra = dealer.dealer_addresses?.[addressIdx]?.state === "Maharashtra";
    }

    const cgst = isMaharashtra ? netTotal * 0.09 : 0;
    const sgst = isMaharashtra ? netTotal * 0.09 : 0;
    const igst = !isMaharashtra ? netTotal * 0.18 : 0;
    const grandTotal = netTotal + cgst + sgst + igst + totalShippingChargesCustomer;

    // Log enhanced items before sending response
    console.log("🚀 ENHANCED ITEMS BEFORE RESPONSE:", JSON.stringify(enhancedItems.map(item => ({
      productName: item.productName,
      quantity: item.quantity,
      discountPercentage: item.discountPercentage,
      schemeDiscountPercentage: item.schemeDiscountPercentage,
      referLP: item.referLP
    })), null, 2));

    // Return comprehensive response
    res.status(200).json({
      message: "Review order calculations retrieved successfully",
      cart: {
        _id: cart._id,
        dealerId: cart.dealerId,
        salesmanId: cart.salesmanId,
        items: cart.items,
        createdAt: cart.createdAt,
        updatedAt: cart.updatedAt,
      },
      items: enhancedItems,
      pricing: {
        totalItems,
        subtotal,
        totalSchemeDiscount,
        totalCashDiscount,
        totalBaseDiscount,
        totalSavings,
        netTotal,
        cgst,
        sgst,
        igst,
        totalShippingChargesCustomer,
        totalShippingChargesCompany,
        grandTotal,
        isMaharashtra,
      },
      dealer: {
        _id: dealer._id,
        name: dealer.dealer_name,
        cashDiscount: dealer.dealer_cashDiscount,
        baseDiscount: dealer.dealer_baseDiscount,
        addresses: dealer.dealer_addresses,
        gstNo: dealer.dealer_gstNo,
        // Dealer model now uses 'dealer_phone' as an array; return the primary number if present
        phone: Array.isArray(dealer.dealer_phone) && dealer.dealer_phone.length > 0 ? dealer.dealer_phone[0] : null,
      },
      schedule: schedule ? {
        _id: schedule._id,
        dealerId: schedule.dealerId,
        orders: schedule.orders,
        createdAt: schedule.createdAt,
        updatedAt: schedule.updatedAt,
      } : null,
    });
  } catch (error) {
    console.error("Error in getReviewOrderCalculations:", error);
    res.status(500).json({
      message: "Error retrieving review order calculations",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Create backorder from split
export const createBackorderFromSplits: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { historyId, orderId, splits, backorderReason, shippingChargeType, shippingChargeAmount } = req.body;

    console.log('🔍 CREATE BACKORDER - Request received:', { historyId, orderId, splitsCount: splits?.length });

    // Validate inputs
    if (!historyId || !orderId || !Array.isArray(splits) || splits.length === 0) {
      res.status(400).json({ message: "historyId, orderId, and splits array are required" });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(historyId) || !mongoose.Types.ObjectId.isValid(orderId)) {
      res.status(400).json({ message: "Invalid historyId or orderId" });
      return;
    }

    // Validate each split
    for (const split of splits) {
      if (!split.itemId || !split.backorderQuantity || split.backorderQuantity <= 0) {
        res.status(400).json({
          message: "Each split must have itemId and backorderQuantity > 0"
        });
        return;
      }
    }

    // Validate shipping charges if provided
    if (shippingChargeType && shippingChargeType !== "To Pay" && shippingChargeType !== "Paid") {
      res.status(400).json({ message: "shippingChargeType must be 'To Pay' or 'Paid'" });
      return;
    }

    if (shippingChargeType === "Paid" && (shippingChargeAmount === undefined || shippingChargeAmount < 0)) {
      res.status(400).json({ message: "shippingChargeAmount must be >= 0 when shippingChargeType is 'Paid'" });
      return;
    }

    // Find the original order history
    const orderHistory = await OrderHistory.findById(historyId);
    if (!orderHistory) {
      res.status(404).json({ message: "Order history not found" });
      return;
    }

    // Find the specific order
    const orderIndex = orderHistory.orders.findIndex(o => o._id.toString() === orderId);
    if (orderIndex === -1) {
      res.status(404).json({ message: "Order not found in history" });
      return;
    }

    const originalOrder = orderHistory.orders[orderIndex];

    // Count existing backorders for this parent order to determine backorder number
    const existingBackordersCount = await OrderHistory.countDocuments({
      'orders.parentOrderId': orderId
    });
    const backorderNumber = existingBackordersCount + 1;

    console.log(`📊 Existing backorders for order ${orderId}: ${existingBackordersCount}, new backorder number: ${backorderNumber}`);

    // Process each split
    const backorderItems: IOrderItem[] = [];
    let backorderTotalAmount = 0;

    for (const split of splits) {
      // Find the item in the original order
      const itemIndex = originalOrder.items.findIndex(
        item => item._id.toString() === split.itemId
      );

      if (itemIndex === -1) {
        res.status(404).json({
          message: `Item ${split.itemId} not found in order ${orderId}`
        });
        return;
      }

      const originalItem = originalOrder.items[itemIndex];
      const originalQuantity = originalItem.quantity;
      const backorderQuantity = split.backorderQuantity;

      // DEBUG LOGGING - Understanding quantity mismatch
      console.log('🔍 SPLIT VALIDATION DEBUG:', {
        itemId: split.itemId,
        itemIndex,
        originalItem: {
          _id: originalItem._id,
          itemId: originalItem.itemId.toString(),
          quantity: originalItem.quantity,
          orderCode: originalItem.orderCode,
          priceAtTimeOfOrder: originalItem.priceAtTimeOfOrder
        },
        split: {
          itemId: split.itemId,
          backorderQuantity: split.backorderQuantity
        },
        order: {
          _id: originalOrder._id,
          itemsCount: originalOrder.items.length,
          allItemQuantities: originalOrder.items.map(i => ({
            id: i._id,
            itemId: i.itemId.toString(),
            qty: i.quantity,
            orderCode: i.orderCode
          }))
        }
      });

      // Validate split quantity
      // Allow backorderQuantity === originalQuantity (currentStock = 0, entire product to backorder)
      // Reject backorderQuantity > originalQuantity (invalid)
      if (backorderQuantity > originalQuantity) {
        res.status(400).json({
          message: `Backorder quantity (${backorderQuantity}) cannot exceed original quantity (${originalQuantity})`,
          debug: {
            requestedBackorder: backorderQuantity,
            actualItemQuantity: originalQuantity,
            itemId: split.itemId,
            orderItemId: originalItem._id
          }
        });
        return;
      }

      const currentStockQuantity = originalQuantity - backorderQuantity;

      console.log(`✂️ Splitting item ${originalItem._id}: Original=${originalQuantity}, Current Stock=${currentStockQuantity}, Backorder=${backorderQuantity}`);

      // Update original item quantity to current stock
      orderHistory.orders[orderIndex].items[itemIndex].quantity = currentStockQuantity;

      // Create backorder item (same as original but with backorder quantity)
      // Generate unique orderCode for backorder to avoid duplicate key error
      const uniqueBackorderCode = `${originalItem.orderCode}-BO${backorderNumber}`;

      const backorderItem: IOrderItem = {
        _id: new mongoose.Types.ObjectId() as any,
        itemId: originalItem.itemId,
        quantity: backorderQuantity,
        priceAtTimeOfOrder: originalItem.priceAtTimeOfOrder,
        scheduleDate: originalItem.scheduleDate,
        shipmentStatus: "Pending",
        orderCode: uniqueBackorderCode, // Unique code to prevent duplicate key error
        referLP: originalItem.referLP || false,
        // Apply shipping charges to backorder item
        shippingChargeType: shippingChargeType || "To Pay",
        shippingChargeAmount: shippingChargeType === "Paid" ? (shippingChargeAmount || 0) : 0,
        deliveryPartner: originalItem.deliveryPartner,
        schemeDiscountPercentage: originalItem.schemeDiscountPercentage,
        schemeDiscountAmount: originalItem.schemeDiscountAmount,
      };

      backorderItems.push(backorderItem);

      // Calculate backorder amount
      const itemTotal = originalItem.priceAtTimeOfOrder * backorderQuantity;
      backorderTotalAmount += itemTotal;
    }

    // Add shipping to backorder total if Paid
    if (shippingChargeType === "Paid" && shippingChargeAmount) {
      backorderTotalAmount += shippingChargeAmount;
    }

    // Add 18% GST to backorder total (CGST 9% + SGST 9% or IGST 18%)
    const subtotalBeforeGST = backorderTotalAmount;
    const gstAmount = subtotalBeforeGST * 0.18; // 18% GST
    backorderTotalAmount += gstAmount;

    console.log(`💰 Backorder pricing: Subtotal=₹${subtotalBeforeGST.toFixed(2)}, GST (18%)=₹${gstAmount.toFixed(2)}, Total=₹${backorderTotalAmount.toFixed(2)}`);

    // Create backorder order
    const backorderOrder: IOrder = {
      _id: new mongoose.Types.ObjectId() as any,
      orderDate: new Date().toISOString(),
      finalAmt: backorderTotalAmount,
      salesmanId: originalOrder.salesmanId,
      items: backorderItems,
      deliveryAddressIndex: originalOrder.deliveryAddressIndex,
      // Backorder specific fields
      isBackorder: true,
      parentOrderId: orderId,
      backorderNumber: backorderNumber,
      backorderReason: backorderReason || "Stock shortage",
      backorderCreatedDate: new Date().toISOString(),
      orderNote: `Backorder BO${backorderNumber} - ${backorderReason || "Stock shortage"}`,
    };

    // Create new OrderHistory document for the backorder
    const backorderHistory = new OrderHistory({
      dealerId: orderHistory.dealerId,
      orders: [backorderOrder],
    });

    // Recalculate finalAmt for original order (reduced quantity)
    let updatedOriginalAmount = 0;
    for (const item of orderHistory.orders[orderIndex].items) {
      updatedOriginalAmount += item.priceAtTimeOfOrder * item.quantity;
    }
    orderHistory.orders[orderIndex].finalAmt = updatedOriginalAmount;

    // Save both documents
    await orderHistory.save();
    await backorderHistory.save();

    console.log(`✅ Backorder created successfully: BO${backorderNumber} with ${backorderItems.length} items`);

    res.status(200).json({
      message: "Backorder created successfully",
      data: orderHistory,
      backorderInfo: {
        backorderHistoryId: backorderHistory._id,
        backorderOrderId: backorderOrder._id,
        backorderNumber: backorderNumber,
        itemsCount: backorderItems.length,
        totalAmount: backorderTotalAmount,
      }
    });

  } catch (error) {
    console.error("❌ Error creating backorder:", error);
    res.status(500).json({
      message: "Error creating backorder",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};;