import { io } from '../server.js';
import Notification from '../models/Notification.js';
import Document from '../models/Document.js';
import DocumentPermission from '../models/DocumentPermission.js';
import DocumentVersion from '../models/DocumentVersion.js';
import DocumentExtraction from '../models/DocumentExtraction.js';
import DocumentPriority from '../models/DocumentPriority.js';
import User from '../models/User.js';
import { uploadProvider, uploadToS3 } from '../utils/upload.js';
import { sendNotification } from "../utils/sendNotification.js";

import dotenv from 'dotenv';
dotenv.config();

const formatDocumentForClient = (doc) => {
  const plain = doc?.toObject ? doc.toObject() : doc;
  if (plain?.department_id && typeof plain.department_id === "object") {
    plain.department = plain.department_id;
  }
  return plain;
};

const mapPriorityLevelToUrgency = (priorityLevel) => {
  const normalized = String(priorityLevel || "").trim().toLowerCase();
  if (normalized === "critical" || normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  if (normalized === "low") return "low";
  return "medium";
};

export const createDocument = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("department_id");
    if (!user) return res.status(401).json({ message: "User not found" });

    const payload = req.body;
    payload.uploaded_by = req.userId;
    // Default to uploader's department when department_id is not provided.
    if (!payload.department_id && user.department_id) {
      payload.department_id = user.department_id;
    }

    if (req.file) {
      if (uploadProvider === 's3') {
        const key = `${Date.now()}_${req.file.originalname}`;
        const s3resp = await uploadToS3(req.file.buffer, key, req.file.mimetype);
        payload.file_url = s3resp.Location || `${process.env.S3_BASE_URL}/${key}`;
      } else {
        payload.file_url = `/uploads/${req.file.filename}`;
      }
      payload.file_type = req.file.mimetype;
    }

    const doc = await Document.create(payload);

    await DocumentPermission.create({
      document_id: doc._id,
      user_id: req.userId,
      permission_level: "admin",
      granted_by: req.userId,
    });

    await DocumentVersion.create({
      document_id: doc._id,
      version_number: 1,
      content: doc.content,
      changed_by: req.userId,
      change_summary: "Initial version",
    });

    // 🔔 Send Notification
    await sendNotification(
      req.userId,
      `Your document "${doc.title}" has been uploaded.`,
      "success"
    );

    const hydrated = await Document.findById(doc._id).populate('department_id', 'name color');
    res.json(formatDocumentForClient(hydrated));

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};


export const getDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await Document.findById(id)
      .populate('uploaded_by', 'email full_name')
      .populate('department_id', 'name color');
    if (!doc) return res.status(404).json({ message: 'Document not found' });

    const priority = await DocumentPriority.findOne({ document_id: doc._id }).lean();
    res.json({
      ...formatDocumentForClient(doc),
      priority: priority || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

export const listDocuments = async (req, res) => {
  try {
    const docs = await Document.find({})
      .populate('department_id', 'name color')
      .sort({ createdAt: -1 });

    const docIds = docs.map((d) => d._id);
    const priorities = await DocumentPriority.find({
      document_id: { $in: docIds },
    }).lean();
    const priorityByDocumentId = new Map(
      priorities.map((p) => [String(p.document_id), p])
    );

    res.json(
      docs.map((doc) => {
        const formatted = formatDocumentForClient(doc);
        return {
          ...formatted,
          priority: priorityByDocumentId.get(String(doc._id)) || null,
        };
      })
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

export const updateDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await Document.findById(id);
    if (!doc) return res.status(404).json({ message: "Not found" });
    const perm = await DocumentPermission.findOne({
      document_id: id,
      user_id: req.userId,
    });
    const isUploader = doc.uploaded_by?.toString() === req.userId;

    if (!isUploader && !perm) {
      return res.status(403).json({ message: "Not allowed" });
    }

    if (req.file) {
      if (uploadProvider === "s3") {
        const key = `${Date.now()}_${req.file.originalname}`;
        const s3resp = await uploadToS3(
          req.file.buffer,
          key,
          req.file.mimetype
        );
        req.body.file_url =
          s3resp.Location || `${process.env.S3_BASE_URL}/${key}`;
      } else {
        req.body.file_url = `/uploads/${req.file.filename}`;
      }
      req.body.file_type = req.file.mimetype;
    }

    const extractionPayload = req.body.extraction;
    if (extractionPayload && typeof extractionPayload === "object") {
      const parsedDeadline = extractionPayload.selected_deadline
        ? new Date(extractionPayload.selected_deadline)
        : null;
      const safeSelectedDeadline =
        parsedDeadline && !Number.isNaN(parsedDeadline.getTime())
          ? parsedDeadline
          : null;

      const extractionDoc = {
        document_id: id,
        sender: extractionPayload.sender || {},
        document_type: extractionPayload.document_type || "",
        dates: {
          selected_deadline: safeSelectedDeadline,
        },
        urgency_indicators: Array.isArray(extractionPayload.urgency_indicators)
          ? extractionPayload.urgency_indicators
          : [],
        extraction_model_version:
          extractionPayload.extraction_model_version || "rule-v1",
        extraction_confidence:
          typeof extractionPayload.extraction_confidence === "number"
            ? extractionPayload.extraction_confidence
            : 0,
      };

      await DocumentExtraction.findOneAndUpdate(
        { document_id: id },
        { $set: extractionDoc },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    const priorityPayload = req.body.priority;
    if (priorityPayload && typeof priorityPayload === "object") {
      const priorityDoc = {
        document_id: id,
        priority_score:
          typeof priorityPayload.priority_score === "number"
            ? priorityPayload.priority_score
            : 0,
        priority_level: priorityPayload.priority_level || "Low",
        breakdown: priorityPayload.breakdown || {},
        escalation: priorityPayload.escalation || { applied: false, reason: "none" },
        engine_version: priorityPayload.engine_version || "rule-v1",
      };

      await DocumentPriority.findOneAndUpdate(
        { document_id: id },
        { $set: priorityDoc },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      req.body.urgency = mapPriorityLevelToUrgency(priorityDoc.priority_level);
    }

    const updated = await Document.findByIdAndUpdate(id, req.body, {
      new: true,
    });

    if (req.body.content && req.body.content !== doc.content) {
      const latest = await DocumentVersion.find({
        document_id: id,
      })
        .sort({ version_number: -1 })
        .limit(1);

      const nextVersion = (latest[0]?.version_number || 1) + 1;

      await DocumentVersion.create({
        document_id: id,
        version_number: nextVersion,
        content: req.body.content,
        changed_by: req.userId,
        change_summary: req.body.change_summary || "Content updated",
      });
    }

    // 🔔 Send Notification
    await sendNotification(
      doc.uploaded_by,
      `Your document "${doc.title}" was updated.`,
      "info"
    );

    const updatedPriority = await DocumentPriority.findOne({ document_id: id }).lean();
    res.json({
      ...formatDocumentForClient(updated),
      priority: updatedPriority || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};


export const deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await Document.findById(id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    if (doc.uploaded_by.toString() !== req.userId) return res.status(403).json({ message: 'Not allowed' });

    await Document.deleteOne({ _id: id });
    await DocumentPermission.deleteMany({ document_id: id });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};


export const uploadDocument = async (req, res) => {
  try {
    const payload = {
      title: req.body.title,
      content: req.body.content || "",
      uploaded_by: req.userId,
      file_url: req.file ? `/uploads/${req.file.filename}` : null,
      file_type: req.file?.mimetype || null,
    };

    const doc = await Document.create(payload);

    const notification = await Notification.create({
      userId: req.userId,
      documentId: doc._id,
      message: "New document uploaded"
    });

    io.emit("new-notification", notification);

    res.json(doc);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Upload failed" });
  }
};
