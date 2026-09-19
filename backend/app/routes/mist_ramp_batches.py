from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from marshmallow import ValidationError

from app.database import SessionLocal
from app.models.climate_log import ClimateLog
from app.models.mist_ramp_batch import MistRampBatch
from app.models.room import Room
from app.schemas.mist_ramp_batch import (
    MistRampBatchAbortSchema,
    MistRampBatchCreateSchema,
    MistRampBatchOutSchema,
)
from app.utils import validation_error_response

bp = Blueprint("mist_ramp_batches", __name__, url_prefix="/api/mist-ramp-batches")

create_schema = MistRampBatchCreateSchema()
abort_schema = MistRampBatchAbortSchema()
out_schema = MistRampBatchOutSchema()
out_many = MistRampBatchOutSchema(many=True)

MAX_RAMP_SPAN = 30


@bp.get("")
@jwt_required()
def list_mist_ramp_batches():
    db = SessionLocal()
    try:
        room_id = request.args.get("roomId", type=int)
        status = request.args.get("status")
        q = db.query(MistRampBatch)
        if room_id is not None:
            q = q.filter(MistRampBatch.room_id == room_id)
        if status:
            q = q.filter(MistRampBatch.status == status)
        rows = q.order_by(MistRampBatch.opened_at.desc()).all()
        return jsonify(out_many.dump(rows))
    finally:
        db.close()


@bp.post("")
@jwt_required()
def create_mist_ramp_batch():
    db = SessionLocal()
    try:
        try:
            data = create_schema.load(request.get_json(silent=True) or {})
        except ValidationError as err:
            return validation_error_response(err)

        start = data["start_humidity"]
        target = data["target_humidity"]
        if start >= target:
            return jsonify({"detail": "startHumidity 必须小于 targetHumidity"}), 400
        if target - start > MAX_RAMP_SPAN:
            return jsonify({"detail": "湿度爬坡幅度超过 30，不允许开批次"}), 400

        room = db.query(Room).filter(Room.id == data["room_id"]).first()
        if not room:
            return jsonify({"detail": "出菇室不存在"}), 400
        if room.status == "idle":
            return jsonify({"detail": "闲置(idle)出菇室禁止开补湿批次"}), 400
        notes = (data.get("notes") or "").strip() or None
        if room.status == "sanitize" and not notes:
            return jsonify({"detail": "消毒(sanitize)出菇室开批次须填写备注 notes"}), 400

        existing = (
            db.query(MistRampBatch)
            .filter(MistRampBatch.room_id == room.id, MistRampBatch.status == "open")
            .first()
        )
        if existing:
            return (
                jsonify(
                    {
                        "detail": "该出菇室已有进行中的补湿批次",
                        "existingBatchId": existing.id,
                    }
                ),
                409,
            )

        item = MistRampBatch(
            room_id=room.id,
            start_humidity=start,
            target_humidity=target,
            status="open",
            opened_at=datetime.now(timezone.utc),
            closed_at=None,
            abort_reason=None,
            notes=notes,
        )
        db.add(item)
        db.commit()
        db.refresh(item)
        return jsonify(out_schema.dump(item)), 201
    finally:
        db.close()


@bp.post("/<int:batch_id>/complete")
@jwt_required()
def complete_mist_ramp_batch(batch_id: int):
    db = SessionLocal()
    try:
        item = db.query(MistRampBatch).filter(MistRampBatch.id == batch_id).first()
        if not item:
            return jsonify({"detail": "补湿批次不存在"}), 404
        if item.status != "open":
            return jsonify({"detail": "补湿批次已关闭，不能重复完结"}), 409

        now = datetime.now(timezone.utc)
        item.status = "complete"
        item.closed_at = now

        last_log = (
            db.query(ClimateLog)
            .filter(ClimateLog.room_id == item.room_id)
            .order_by(ClimateLog.recorded_at.desc())
            .first()
        )
        db.add(
            ClimateLog(
                room_id=item.room_id,
                recorded_at=now,
                temp_c=last_log.temp_c if last_log else 16.0,
                humidity_pct=item.target_humidity,
                co2_ppm=None,
                notes=f"补湿批次 #{item.id} 完成，湿度达标 {item.target_humidity}%",
            )
        )
        db.commit()
        db.refresh(item)
        return jsonify(out_schema.dump(item))
    finally:
        db.close()


@bp.post("/<int:batch_id>/abort")
@jwt_required()
def abort_mist_ramp_batch(batch_id: int):
    db = SessionLocal()
    try:
        try:
            data = abort_schema.load(request.get_json(silent=True) or {})
        except ValidationError as err:
            return validation_error_response(err)

        item = db.query(MistRampBatch).filter(MistRampBatch.id == batch_id).first()
        if not item:
            return jsonify({"detail": "补湿批次不存在"}), 404
        if item.status != "open":
            return jsonify({"detail": "补湿批次已关闭，不能中止"}), 409

        item.status = "abort"
        item.closed_at = datetime.now(timezone.utc)
        item.abort_reason = data["abort_reason"].strip()
        db.commit()
        db.refresh(item)
        return jsonify(out_schema.dump(item))
    finally:
        db.close()
