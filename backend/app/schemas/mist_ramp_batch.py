from marshmallow import Schema, fields, validate


class MistRampBatchCreateSchema(Schema):
    room_id = fields.Int(required=True, data_key="roomId")
    start_humidity = fields.Int(
        required=True,
        data_key="startHumidity",
        validate=validate.Range(min=1, max=100, error="startHumidity 须在 1–100 之间"),
    )
    target_humidity = fields.Int(
        required=True,
        data_key="targetHumidity",
        validate=validate.Range(min=1, max=100, error="targetHumidity 须在 1–100 之间"),
    )
    notes = fields.Str(allow_none=True)


class MistRampBatchAbortSchema(Schema):
    abort_reason = fields.Str(
        required=True,
        data_key="abortReason",
        validate=validate.Length(min=1, error="abortReason 必填"),
    )


class MistRampBatchOutSchema(Schema):
    id = fields.Int(dump_only=True)
    room_id = fields.Int(data_key="roomId")
    start_humidity = fields.Int(data_key="startHumidity")
    target_humidity = fields.Int(data_key="targetHumidity")
    status = fields.Str()
    opened_at = fields.DateTime(data_key="openedAt")
    closed_at = fields.DateTime(allow_none=True, data_key="closedAt")
    abort_reason = fields.Str(allow_none=True, data_key="abortReason")
    notes = fields.Str(allow_none=True)
