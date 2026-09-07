import json
import traceback
import pyodbc
from bottle import Bottle, request, response, static_file, run

import os

app = Bottle()

PORT = int(os.environ.get('PORT', 3001))
HOST = os.environ.get('HOST', '0.0.0.0' if os.environ.get('PORT') else 'localhost')

CONN_STR = os.environ.get('DATABASE_URL') or os.environ.get('SQL_CONN_STR') or (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=. ;"
    "DATABASE=CavaControlDB;"
    "TRUSTED_CONNECTION=yes;"
)

def get_db():
    conn = pyodbc.connect(CONN_STR, autocommit=False)
    try:
        conn.setdecoding(pyodbc.SQL_CHAR, encoding='utf-8')
        conn.setdecoding(pyodbc.SQL_WCHAR, encoding='utf-8')
        conn.setencoding(encoding='utf-8')
    except Exception:
        pass
    return conn

def enable_cors(fn):
    def _enable_cors(*args, **kwargs):
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Origin, Accept, Content-Type, X-Requested-With'
        if request.method == 'OPTIONS':
            return {}
        return fn(*args, **kwargs)
    return _enable_cors

# --- API ENDPOINTS (MUST BE DEFINED BEFORE WILDCARD STATIC ROUTES) ---

@app.route('/api/health', method=['GET', 'OPTIONS'])
@enable_cors
def health():
    try:
        conn = get_db()
        conn.close()
        return {"status": "ok", "db": "SQL Server 2019 (CavaControlDB)"}
    except Exception as e:
        response.status = 500
        return {"status": "error", "message": str(e)}

@app.route('/api/auth/login', method=['POST', 'OPTIONS'])
@enable_cors
def auth_login():
    try:
        data = request.json or json.loads(request.body.read().decode('utf-8'))
        email = (data.get('email') or '').strip().lower()
        password = (data.get('password') or '').strip()

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT id, nombre, email, password, rol FROM Usuarios WHERE LOWER(email) = ?", (email,))
        row = cursor.fetchone()
        conn.close()

        if row and row[3] == password:
            return {
                "success": True,
                "user": {
                    "id": str(row[0]),
                    "nombre": str(row[1]),
                    "email": str(row[2]),
                    "rol": str(row[4])
                }
            }
        else:
            response.status = 401
            return {"success": False, "message": "Credenciales inválidas. Verifique su email y contraseña."}
    except Exception as e:
        print("ERROR login:", traceback.format_exc())
        response.status = 500
        return {"success": False, "message": str(e)}

@app.route('/api/auth/register', method=['POST', 'OPTIONS'])
@enable_cors
def auth_register():
    try:
        data = request.json or json.loads(request.body.read().decode('utf-8'))
        nombre = (data.get('nombre') or '').strip()
        email = (data.get('email') or '').strip().lower()
        password = (data.get('password') or '').strip()

        if not nombre or not email or not password:
            response.status = 400
            return {"success": False, "message": "Todos los campos son obligatorios."}

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM Usuarios WHERE LOWER(email) = ?", (email,))
        if cursor.fetchone()[0] > 0:
            conn.close()
            response.status = 400
            return {"success": False, "message": "El correo ya se encuentra registrado."}

        user_id = f"usr-{int(pyodbc.datetime.datetime.now().timestamp()*1000)}"
        cursor.execute(
            "INSERT INTO Usuarios (id, nombre, email, password, rol, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, nombre, email, password, 'Usuario', pyodbc.datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        )
        conn.commit()
        conn.close()

        return {
            "success": True,
            "user": {
                "id": user_id,
                "nombre": nombre,
                "email": email,
                "rol": "Usuario"
            }
        }
    except Exception as e:
        print("ERROR register:", traceback.format_exc())
        response.status = 500
        return {"success": False, "message": str(e)}

@app.route('/api/db', method=['GET', 'OPTIONS'])
@enable_cors
def get_full_state():
    try:
        conn = get_db()
        cursor = conn.cursor()

        # Usuarios
        cursor.execute("SELECT id, nombre, email, password, rol, fecha_creacion FROM Usuarios")
        usuarios = [{"id": str(r[0]), "nombre": str(r[1]), "email": str(r[2]), "password": str(r[3]), "rol": str(r[4]), "fechaCreacion": str(r[5] or '')} for r in cursor.fetchall()]

        # Proveedores
        cursor.execute("SELECT id, nombre, telefono, email FROM Proveedores")
        proveedores = [{"id": str(r[0]), "nombre": str(r[1]), "telefono": str(r[2] or ''), "email": str(r[3] or '')} for r in cursor.fetchall()]

        # Articulos + Proveedores
        cursor.execute("SELECT id, bodega, etiqueta, cepa, uxb FROM Articulos")
        articulos_rows = cursor.fetchall()
        
        cursor.execute("SELECT articulo_id, proveedor_id FROM ArticuloProveedores")
        art_provs_map = {}
        for r in cursor.fetchall():
            art_provs_map.setdefault(str(r[0]), []).append(str(r[1]))

        articulos = []
        for r in articulos_rows:
            art_id = str(r[0])
            articulos.append({
                "id": art_id,
                "bodega": str(r[1]),
                "etiqueta": str(r[2]),
                "cepa": str(r[3]),
                "uxb": int(r[4]),
                "proveedoresIds": art_provs_map.get(art_id, [])
            })

        # Membresias + Items + Tipo + Precio
        cursor.execute("SELECT id, codigo, descripcion, fecha_desde, fecha_hasta, ganancia, tipo, precio FROM Membresias")
        membresias_rows = cursor.fetchall()

        cursor.execute("SELECT membresia_id, articulo_id, cantidad FROM MembresiaItems")
        memb_items_map = {}
        for r in cursor.fetchall():
            memb_items_map.setdefault(str(r[0]), []).append({"articuloId": str(r[1]), "cantidad": int(r[2])})

        membresias = []
        for r in membresias_rows:
            m_id = str(r[0])
            membresias.append({
                "id": m_id,
                "codigo": str(r[1]),
                "descripcion": str(r[2]),
                "fechaDesde": str(r[3] or ''),
                "fechaHasta": str(r[4] or ''),
                "ganancia": float(r[5] or 0),
                "tipo": str(r[6] or 'Selección') if len(r) > 6 else 'Selección',
                "precio": float(r[7] or 0) if len(r) > 7 else 0,
                "items": memb_items_map.get(m_id, [])
            })

        # Clientes
        cursor.execute("SELECT id, nombre, apellido, telefono, provincia, localidad, direccion, membresia_id FROM Clientes")
        clientes = [{
            "id": str(r[0]), "nombre": str(r[1]), "apellido": str(r[2]), "telefono": str(r[3] or ''),
            "provincia": str(r[4] or ''), "localidad": str(r[5] or ''), "direccion": str(r[6] or ''), "membresiaId": str(r[7] or '')
        } for r in cursor.fetchall()]

        # Entradas
        cursor.execute("SELECT id, numero_compra, articulo_id, cepa, proveedor_id, cantidad_cajas, unidades_sumadas, precio_caja, costo_adicional, fecha FROM Entradas")
        entradas = [{
            "id": str(r[0]), "numeroCompra": int(r[1]), "articuloId": str(r[2]), "cepa": str(r[3] or ''),
            "proveedorId": str(r[4]), "cantidadCajas": int(r[5]), "unidadesSumadas": int(r[6]),
            "precioCaja": float(r[7] or 0), "costoAdicionalCaja": float(r[8] or 0) if len(r) > 8 else 0, "fecha": str(r[9] or '') if len(r) > 9 else ''
        } for r in cursor.fetchall()]

        # Salidas
        cursor.execute("SELECT id, fecha, cliente_id, tipo_venta, articulo_id, membresia_id, cantidad_botellas, detalle FROM Salidas")
        salidas = [{
            "id": str(r[0]), "fecha": str(r[1] or ''), "clienteId": str(r[2]), "tipoVenta": str(r[3]),
            "articuloId": str(r[4]), "membresiaId": str(r[5] or ''), "cantidadBotellas": int(r[6]), "detalle": str(r[7] or '')
        } for r in cursor.fetchall()]

        # AuditoriaLogs
        cursor.execute("SELECT id, fecha_hora, usuario, modulo, accion, detalle FROM AuditoriaLogs ORDER BY fecha_hora DESC")
        auditoriaLogs = [{
            "id": str(r[0]), "fechaHora": str(r[1]), "usuario": str(r[2]), "modulo": str(r[3]), "accion": str(r[4]), "detalle": str(r[5] or '')
        } for r in cursor.fetchall()]

        conn.close()

        return {
          "usuarios": usuarios,
          "proveedores": proveedores,
          "articulos": articulos,
          "membresias": membresias,
          "clientes": clientes,
          "entradas": entradas,
          "salidas": salidas,
          "auditoriaLogs": auditoriaLogs
        }
    except Exception as e:
        print("ERROR get_full_state:", traceback.format_exc())
        response.status = 500
        return {"error": str(e)}

@app.route('/api/db/sync', method=['POST', 'OPTIONS'])
@enable_cors
def sync_full_state():
    try:
        data = request.json
        if not data:
            data = json.loads(request.body.read().decode('utf-8'))

        conn = get_db()
        cursor = conn.cursor()

        # Clear existing tables in safe order
        cursor.execute("DELETE FROM AuditoriaLogs;")
        cursor.execute("DELETE FROM Salidas;")
        cursor.execute("DELETE FROM Entradas;")
        cursor.execute("DELETE FROM Clientes;")
        cursor.execute("DELETE FROM MembresiaItems;")
        cursor.execute("DELETE FROM Membresias;")
        cursor.execute("DELETE FROM ArticuloProveedores;")
        cursor.execute("DELETE FROM Articulos;")
        cursor.execute("DELETE FROM Proveedores;")
        cursor.execute("DELETE FROM Usuarios;")

        cursor.fast_executemany = True

        # 0. Usuarios Bulk Insert
        usr_rows = [(str(u['id']), str(u['nombre'])[:150], str(u['email'])[:255], str(u.get('password', '123456'))[:255], str(u.get('rol', 'Usuario'))[:50], str(u.get('fechaCreacion', ''))[:50]) for u in data.get('usuarios', [])]
        if usr_rows:
            cursor.executemany("INSERT INTO Usuarios (id, nombre, email, password, rol, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?)", usr_rows)

        # 1. Proveedores Bulk Insert
        prov_rows = [(str(p['id']), str(p['nombre'])[:255], str(p.get('telefono', ''))[:100], str(p.get('email', ''))[:255]) for p in data.get('proveedores', [])]
        if prov_rows:
            cursor.executemany("INSERT INTO Proveedores (id, nombre, telefono, email) VALUES (?, ?, ?, ?)", prov_rows)

        valid_prov_ids = {p[0] for p in prov_rows}

        # 2. Articulos & ArticuloProveedores Bulk Insert
        art_rows = [(str(a['id']), str(a['bodega'])[:255], str(a['etiqueta'])[:255], str(a['cepa'])[:255], int(a.get('uxb', 6))) for a in data.get('articulos', [])]
        if art_rows:
            cursor.executemany("INSERT INTO Articulos (id, bodega, etiqueta, cepa, uxb) VALUES (?, ?, ?, ?, ?)", art_rows)

        art_prov_rows = []
        for a in data.get('articulos', []):
            art_id = str(a['id'])
            seen_pids = set()
            for pid in a.get('proveedoresIds', []):
                pid_str = str(pid)
                if pid_str in valid_prov_ids and pid_str not in seen_pids:
                    seen_pids.add(pid_str)
                    art_prov_rows.append((art_id, pid_str))
        if art_prov_rows:
            cursor.executemany("INSERT INTO ArticuloProveedores (articulo_id, proveedor_id) VALUES (?, ?)", art_prov_rows)

        # 3. Membresias & MembresiaItems Bulk Insert (con tipo y precio)
        memb_rows = [(str(m['id']), str(m['codigo'])[:50], str(m['descripcion'])[:255], str(m.get('fechaDesde', ''))[:20], str(m.get('fechaHasta', ''))[:20], float(m.get('ganancia', 40)), str(m.get('tipo', 'Selección'))[:100], float(m.get('precio', 0))) for m in data.get('membresias', [])]
        if memb_rows:
            cursor.executemany("INSERT INTO Membresias (id, codigo, descripcion, fecha_desde, fecha_hasta, ganancia, tipo, precio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", memb_rows)

        memb_items_rows = []
        for m in data.get('membresias', []):
            m_id = str(m['id'])
            items = m.get('items', [])
            if not items and m.get('articuloId'):
                items = [{"articuloId": m['articuloId'], "cantidad": m.get('cantidad', 1)}]
            seen_items = set()
            for item in items:
                art_id_str = str(item['articuloId'])
                if art_id_str not in seen_items:
                    seen_items.add(art_id_str)
                    memb_items_rows.append((m_id, art_id_str, int(item.get('cantidad', 1))))
        if memb_items_rows:
            cursor.executemany("INSERT INTO MembresiaItems (membresia_id, articulo_id, cantidad) VALUES (?, ?, ?)", memb_items_rows)

        # 4. Clientes Bulk Insert
        cli_rows = [(str(c['id']), str(c['nombre'])[:150], str(c['apellido'])[:150], str(c.get('telefono', ''))[:100], str(c.get('provincia', ''))[:100], str(c.get('localidad', ''))[:100], str(c.get('direccion', ''))[:255], str(c.get('membresiaId', ''))[:100]) for c in data.get('clientes', [])]
        if cli_rows:
            cursor.executemany("INSERT INTO Clientes (id, nombre, apellido, telefono, provincia, localidad, direccion, membresia_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", cli_rows)

        # 5. Entradas Bulk Insert
        ent_rows = [(str(e['id']), int(e['numeroCompra']), str(e['articuloId']), str(e.get('cepa', ''))[:255], str(e['proveedorId']), int(e['cantidadCajas']), int(e['unidadesSumadas']), float(e['precioCaja']), float(e.get('costoAdicionalCaja', 0)), str(e.get('fecha', ''))[:20]) for e in data.get('entradas', [])]
        if ent_rows:
            cursor.executemany("INSERT INTO Entradas (id, numero_compra, articulo_id, cepa, proveedor_id, cantidad_cajas, unidades_sumadas, precio_caja, costo_adicional, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ent_rows)

        # 6. Salidas Bulk Insert
        sal_rows = [(str(s['id']), str(s.get('fecha', ''))[:20], str(s['clienteId']), str(s['tipoVenta'])[:50], str(s['articuloId']), str(s.get('membresiaId', ''))[:100] if s.get('membresiaId') else None, int(s['cantidadBotellas']), str(s.get('detalle', ''))[:255]) for s in data.get('salidas', [])]
        if sal_rows:
            cursor.executemany("INSERT INTO Salidas (id, fecha, cliente_id, tipo_venta, articulo_id, membresia_id, cantidad_botellas, detalle) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", sal_rows)

        # 7. AuditoriaLogs Bulk Insert
        audit_rows = [(str(log['id']), str(log['fechaHora'])[:50], str(log['usuario'])[:255], str(log['modulo'])[:100], str(log['accion'])[:100], str(log.get('detalle', ''))) for log in data.get('auditoriaLogs', [])]
        if audit_rows:
            cursor.executemany("INSERT INTO AuditoriaLogs (id, fecha_hora, usuario, modulo, accion, detalle) VALUES (?, ?, ?, ?, ?, ?)", audit_rows)

        conn.commit()
        conn.close()

        return {"success": True, "message": "Datos sincronizados masivamente a alta velocidad en SQL Server 2019 (CavaControlDB)"}

    except Exception as e:
        print("ERROR DURANTE SYNC BULK SQL SERVER:", traceback.format_exc())
        response.status = 500
        return {"error": str(e)}

# --- STATIC FILE ROUTES (MUST BE AT THE END) ---

@app.route('/<filename:path>', method=['GET', 'OPTIONS'])
@enable_cors
def serve_static(filename):
    return static_file(filename, root='.')

@app.route('/', method=['GET', 'OPTIONS'])
@enable_cors
def serve_index():
    return static_file('index.html', root='.')

if __name__ == '__main__':
    print(f"Iniciando servidor de conexión CavaControl en http://{HOST}:{PORT} ...")
    run(app, host=HOST, port=PORT, quiet=False)
