import re
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from marshmallow import ValidationError

from app.database import SessionLocal
from app.models.climate_log import ClimateLog
from app.models.mist_ramp_batch import MIST_RAMP_STATUSES, MistRampBatch
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
_CJK_RE = re.compile(r"[一-鿿]")


def _get_open_batch(db, room_id: int):
    return (
        db.query(MistRampBatch)
        .filter(MistRampBatch.room_id == room_id, MistRampBatch.status == "open")
        .first()
    )


@bp.get("")
@jwt_required()
def list_mist_ramp_batches():
    db = SessionLocal()
    try:
        room_id = request.args.get("roomId", type=int)
        status = request.args.get("status")
        if status is not None and status not in MIST_RAMP_STATUSES:
            return jsonify({"detail": "status 须为 open|complete|abort"}), 400
        q = db.query(MistRampBatch)
        if room_id is not None:
            q = q.filter(MistRampBatch.room_id == room_id)
        if status is not None:
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

        room = db.query(Room).filter(Room.id == data["room_id"]).first()
        if not room:
            return jsonify({"detail": "出菇室不存在"}), 400

        start = data["start_humidity"]
        target = data["target_humidity"]
        if start >= target:
            return jsonify({"detail": "startHumidity 必须小于 targetHumidity"}), 400
        if target - start > MAX_RAMP_SPAN:
            return jsonify({"detail": f"湿度爬坡幅度不能超过 {MAX_RAMP_SPAN} 个百分点"}), 400

        if room.status == "idle":
            return jsonify({"detail": "idle(闲置)出菇室禁止开补湿批次"}), 400
        notes = (data.get("notes") or "").strip() or None
        if room.status == "sanitize" and not notes:
            return jsonify({"detail": "sanitize(消毒)出菇室开补湿批次必须填写备注 notes"}), 400

        existing = _get_open_batch(db, room.id)
        if existing:
            return (
                jsonify(
                    {
                        "detail": f"该出菇室已有进行中的补湿批次 #{existing.id}",
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
            return jsonify({"detail": "仅 open 状态的批次可以完成"}), 400

        now = datetime.now(timezone.utc)
        item.status = "complete"
        item.closed_at = now

        # 达标落账:必须写入一条湿度等于 targetHumidity 的环境记录
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
                temp_c=last_log.temp_c if last_log else 18.0,
                humidity_pct=item.target_humidity,
                co2_ppm=last_log.co2_ppm if last_log else None,
                notes=f"补湿批次 #{item.id} 达标完成",
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
            return jsonify({"detail": "仅 open 状态的批次可以中止"}), 400

        reason = data["abort_reason"].strip()
        if not _CJK_RE.search(reason):
            return jsonify({"detail": "abortReason 必须填写中文原因"}), 400

        item.status = "abort"
        item.closed_at = datetime.now(timezone.utc)
        item.abort_reason = reason
        db.commit()
        db.refresh(item)
        return jsonify(out_schema.dump(item))
    finally:
        db.close()


@bp.delete("/<int:batch_id>")
@jwt_required()
def delete_mist_ramp_batch(batch_id: int):
    db = SessionLocal()
    try:
        item = db.query(MistRampBatch).filter(MistRampBatch.id == batch_id).first()
        if not item:
            return jsonify({"detail": "补湿批次不存在"}), 404
        db.delete(item)
        db.commit()
        return "", 204
    finally:
        db.close()
