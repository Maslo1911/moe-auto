"""Методы 5–6: справочники «Категории ремонта» и «Виды топлива».
Чтение — любому пользователю; изменение — только администратору (роль «администратор», п. 4.3.7 ТЗ)."""
from fastapi import APIRouter, Depends, Response
from sqlalchemy import exists, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import admin_user, current_user, json_body, parse_id
from ..errors import ApiError, invalid, not_found
from ..models import FuelType, Refuel, Repair, RepairCategory
from ..services import dict_view

router = APIRouter(tags=["Справочники"])

DICTS = {
    "repair-categories": (RepairCategory, Repair.category_id, "Категория"),
    "fuel-types": (FuelType, Refuel.fuel_type_id, "Вид топлива"),
}


def _name(body: dict) -> str:
    name = body.get("name")
    name = name.strip() if isinstance(name, str) else ""
    if not name or len(name) > 50:
        raise invalid({"name": "Укажите название, до 50 символов"})
    return name


def _register(path: str):
    model, ref_col, label = DICTS[path]
    duplicate = ApiError(409, "ALREADY_EXISTS", f"{label} с таким названием уже есть", {"name": "Такое название уже есть"})

    @router.get(f"/{path}", name=f"list_{path}")
    def list_items(_=Depends(current_user), db: Session = Depends(get_db)):
        return [dict_view(x) for x in db.scalars(select(model).order_by(model.id))]

    @router.post(f"/{path}", status_code=201, name=f"create_{path}")
    def create_item(body: dict = Depends(json_body), _=Depends(admin_user), db: Session = Depends(get_db)):
        item = model(name=_name(body))
        db.add(item)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise duplicate
        return dict_view(item)

    @router.put(f"/{path}/{{item_id}}", name=f"update_{path}")
    def update_item(item_id: str, body: dict = Depends(json_body), _=Depends(admin_user), db: Session = Depends(get_db)):
        iid = parse_id(item_id)
        item = db.get(model, iid) if iid and iid <= 32767 else None
        if item is None:
            raise not_found()
        item.name = _name(body)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise duplicate
        return dict_view(item)

    @router.delete(f"/{path}/{{item_id}}", status_code=204, name=f"delete_{path}")
    def delete_item(item_id: str, _=Depends(admin_user), db: Session = Depends(get_db)):
        iid = parse_id(item_id)
        item = db.get(model, iid) if iid and iid <= 32767 else None
        if item is None:
            raise not_found()
        if db.scalar(select(exists().where(ref_col == item.id))):
            raise ApiError(409, "IN_USE", f"{label} используется в записях журнала, удалить нельзя")
        db.delete(item)
        db.commit()
        return Response(status_code=204)


for _path in DICTS:
    _register(_path)
