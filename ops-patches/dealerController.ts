import { Request, Response, RequestHandler } from "express";
import mongoose from "mongoose";
import { createRequire } from "module";
import Dealer from "../models/Dealer"; // Import updated Dealer model

const _require = createRequire(import.meta.url);
const { syncCustomer } = _require('../tally/sync');

// Get all dealers
export const getDealers: RequestHandler = async (req, res): Promise<void> => {
  try {
    const dealers = await Dealer.find();
    res.status(200).json(dealers);
  } catch (error) {
    res.status(500).json({ message: "Error fetching dealers", error });
  }
};

// Add a new dealer
export const addDealer: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { 
      dealer_name, 
      dealer_gstNo, 
      dealer_logoUrl, 
      dealer_addresses, // Changed from dealer_location
      dealer_phone, 
      dealer_baseDiscount, 
      dealer_cashDiscount, 
      dealer_status 
    } = req.body;

    // Validate required fields
    if (!dealer_name || !dealer_gstNo || !dealer_logoUrl || !dealer_addresses || !dealer_phone || !Array.isArray(dealer_phone) || dealer_phone.length === 0) {
      res.status(400).json({ message: "All required fields must be provided, and dealer_phone must be a non-empty array" });
      return;
    }

    // Validate dealer_addresses is an array and has at least one address
    if (!Array.isArray(dealer_addresses) || dealer_addresses.length === 0) {
      res.status(400).json({ message: "At least one address is required" });
      return;
    }

    // Validate each address object
    for (const address of dealer_addresses) {
      if (!address.addressLine1 || !address.city || !address.state || !address.country || !address.pinCode) {
        res.status(400).json({ message: "Each address must include addressLine1, city, state, country, and pinCode" });
        return;
      }
    }

    // Check for existing dealer (using dealer_name and first address as unique check)
    const existingDealer = await Dealer.findOne({ 
      dealer_name, 
      "dealer_addresses.addressLine1": dealer_addresses[0].addressLine1 
    });

    if (existingDealer) {
      res.status(400).json({ message: "Dealer with this name and address already exists!" });
      return;
    }

    const newDealer = new Dealer({
      _id: new mongoose.Types.ObjectId(),
      dealer_name,
      dealer_gstNo,
      dealer_logoUrl,
      dealer_addresses, // Updated field
      dealer_phone,
      dealer_baseDiscount: dealer_baseDiscount || 10,
      dealer_cashDiscount: dealer_cashDiscount || 5,
      dealer_status: dealer_status || "active",
    });

    await newDealer.save();

    // Sync new dealer to Tally as a customer ledger (fire-and-forget)
    syncCustomer(newDealer).catch((e: Error) => console.error('[Tally] dealer→customer sync failed:', e.message));

    res.status(201).json({ message: "Dealer added successfully!", dealer: newDealer });

  } catch (error) {
    res.status(500).json({ message: "Error adding dealer", error });
  }
};

// Update a dealer
export const updateDealer: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { dealerId } = req.params; // Changed from _id to dealerId to match route
    console.log("Raw dealerId from req.params:", dealerId); // Debug log
    const trimmedId = dealerId ? dealerId.trim() : null; // Trim whitespace
    console.log("Trimmed dealerId:", trimmedId); // Debug log

    // Check if trimmedId exists and is a valid ObjectId
    if (!trimmedId || !mongoose.Types.ObjectId.isValid(trimmedId)) {
      console.log("Validation failed for dealerId:", trimmedId);
      res.status(400).json({ message: "Invalid dealer ID format!", providedId: trimmedId });
      return;
    }

    const { 
      dealer_name, 
      dealer_gstNo, 
      dealer_logoUrl, 
      dealer_addresses, 
      dealer_phone, 
      dealer_baseDiscount, 
      dealer_cashDiscount, 
      dealer_status 
    } = req.body;

    // Find the dealer by ID
    const dealer = await Dealer.findById(trimmedId);
    if (!dealer) {
      console.log("Dealer not found for dealerId:", trimmedId);
      res.status(404).json({ message: "Dealer not found!" });
      return;
    }

    // If dealer_phone is provided, validate it
    if (dealer_phone) {
      if (!Array.isArray(dealer_phone) || dealer_phone.length === 0) {
        res.status(400).json({ message: "dealer_phone must be a non-empty array" });
        return;
      }
    }

    // Update the dealer
    const updatedDealer = await Dealer.findByIdAndUpdate(
      trimmedId,
      {
        dealer_name,
        dealer_gstNo,
        dealer_logoUrl,
        dealer_addresses: dealer_addresses ?? dealer.dealer_addresses,
        dealer_phone: dealer_phone ?? dealer.dealer_phone,
        dealer_baseDiscount,
        dealer_cashDiscount,
        dealer_status: dealer_status ?? dealer.dealer_status,
      },
      { new: true }
    );

    if (!updatedDealer) {
      console.log("Update failed for dealerId:", trimmedId);
      res.status(500).json({ message: "Failed to update dealer!" });
      return;
    }

    // Sync updated dealer to Tally (fire-and-forget)
    syncCustomer(updatedDealer).catch((e: Error) => console.error('[Tally] dealer update→Tally sync failed:', e.message));

    res.status(200).json({ message: "Dealer updated successfully!", dealer: updatedDealer });
  } catch (error) {
    console.error("Error updating dealer:", error);
    res.status(500).json({ message: "Error updating dealer", error });
  }
};

// Delete a dealer
export const deleteDealer: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { _id } = req.body;

    if (!mongoose.Types.ObjectId.isValid(_id)) {
      res.status(400).json({ message: "Invalid dealer ID!" });
      return;
    }

    const deletedDealer = await Dealer.findByIdAndDelete(_id);

    if (!deletedDealer) {
      res.status(404).json({ message: "Dealer not found!" });
      return;
    }

    res.status(200).json({ message: "Dealer deleted successfully!" });

  } catch (error) {
    res.status(500).json({ message: "Error deleting dealer", error });
  }
};

// Get dealer by ID
export const getDealerById: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { _id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(_id)) {
      res.status(400).json({ message: "Invalid dealer ID!" });
      return;
    }

    const dealer = await Dealer.findById(_id);

    if (!dealer) {
      res.status(404).json({ message: "Dealer not found!" });
      return;
    }

    res.status(200).json(dealer);

  } catch (error) {
    res.status(500).json({ message: "Error fetching dealer", error });
  }
};