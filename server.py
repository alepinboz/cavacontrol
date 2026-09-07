import json
import traceback
import os
import datetime
from bottle import Bottle, request, response, static_file, run, BaseRequest

# Set maximum request body size to 50 MB to support large CSV sync payloads
BaseRequest.MEMFILE_MAX = 50 * 1024 * 1024

app = Bottle()

PORT = int(os.environ.get('PORT', 3001))
HOST = os.environ.get('HOST', '0.0.0.0' if os.environ.get('PORT') else 'localhost')

DATABASE_URL = os.environ.get('DATABASE_URL') or os.environ.get('SQL_CONN_STR') or ""

IS_POSTGRES = False
if DATABASE_URL and (DATABASE_URL.startswith('postgres://') or DATABASE_URL.startswith('postgresql://')):
    IS_POSTGRES = True
    if DATABASE_URL.startswith('postgres://'):
        DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)

def safe_float(val, default=0.0):
    if val is None or val == '':
        return float(default)
    try:
        return float(val)
    except Exception:
        return float(default)

def safe_int(val, default=0):
    if val is None or val == '':
        return int(default)
    try:
        return int(val)
    except Exception:
        return int(default)

def safe_str(val, max_len=None):
    if val is None:
        s = ''
    else:
        s = str(val)
    # Sanitize invalid unicode replacement chars and null bytes
    s = s.replace('\ufffd', 'N' if 'SUE' in s or 'SUE' in s.upper() else 'E' if 'ALMAC' in s or 'ALMAC' in s.upper() else '').replace('\x00', '')
    try:
        s = s.encode('utf-8', 'ignore').decode('utf-8', 'ignore')
    except Exception:
        pass
    if max_len:
        return s[:max_len]
    return s

def get_db():
    if IS_POSTGRES:
        import psycopg2
        url = DATABASE_URL
        if 'sslmode' not in url.lower():
            url += '?sslmode=require' if '?' not in url else '&sslmode=require'
        conn = psycopg2.connect(url)
        try:
            conn.set_client_encoding('UTF8')
        except Exception:
            pass
        return conn
    else:
        import pyodbc
        conn_str = DATABASE_URL or (
            "DRIVER={ODBC Driver 17 for SQL Server};"
            "SERVER=. ;"
            "DATABASE=CavaControlDB;"
            "TRUSTED_CONNECTION=yes;"
        )
        conn = pyodbc.connect(conn_str, autocommit=False)
        try:
            conn.setdecoding(pyodbc.SQL_CHAR, encoding='utf-8')
            conn.setdecoding(pyodbc.SQL_WCHAR, encoding='utf-8')
            conn.setencoding(encoding='utf-8')
        except Exception:
            pass
        return conn

def db_execute(cursor, query, params=None):
    if IS_POSTGRES:
        query_pg = query.replace('?', '%s')
        if params is not None:
            cursor.execute(query_pg, params)
        else:
            cursor.execute(query_pg)
    else:
        if params is not None:
            cursor.execute(query, params)
        else:
            cursor.execute(query)

def db_executemany(cursor, query, params_list):
    if not params_list:
        return
    if IS_POSTGRES:
        query_pg = query.replace('?', '%s')
        for p in params_list:
            cursor.execute(query_pg, p)
    else:
        cursor.fast_executemany = True
        cursor.executemany(query, params_list)

def init_postgres_tables_if_needed():
    if not IS_POSTGRES:
        return
    try:
        conn = get_db()
        cursor = conn.cursor()
        schema_sql = """
        CREATE TABLE IF NOT EXISTS Usuarios (id VARCHAR(100) PRIMARY KEY, nombre VARCHAR(150) NOT NULL, email VARCHAR(255) NOT NULL UNIQUE, password VARCHAR(255) NOT NULL, rol VARCHAR(50) NOT NULL DEFAULT 'Admin', fecha_creacion VARCHAR(50));
        CREATE TABLE IF NOT EXISTS Proveedores (id VARCHAR(100) PRIMARY KEY, nombre VARCHAR(255) NOT NULL, telefono VARCHAR(100), email VARCHAR(255));
        CREATE TABLE IF NOT EXISTS Articulos (id VARCHAR(100) PRIMARY KEY, bodega VARCHAR(255) NOT NULL, etiqueta VARCHAR(255) NOT NULL, cepa VARCHAR(255) NOT NULL, uxb INT NOT NULL DEFAULT 6);
        CREATE TABLE IF NOT EXISTS ArticuloProveedores (articulo_id VARCHAR(100) NOT NULL, proveedor_id VARCHAR(100) NOT NULL, PRIMARY KEY (articulo_id, proveedor_id));
        CREATE TABLE IF NOT EXISTS Membresias (id VARCHAR(100) PRIMARY KEY, tipo VARCHAR(100) NOT NULL DEFAULT 'Selección', codigo VARCHAR(50) NOT NULL, descripcion VARCHAR(255) NOT NULL, fecha_desde VARCHAR(20), fecha_hasta VARCHAR(20), precio DOUBLE PRECISION NOT NULL DEFAULT 0, ganancia DOUBLE PRECISION NOT NULL DEFAULT 40);
        CREATE TABLE IF NOT EXISTS MembresiaItems (membresia_id VARCHAR(100) NOT NULL, articulo_id VARCHAR(100) NOT NULL, cantidad INT NOT NULL DEFAULT 1, PRIMARY KEY (membresia_id, articulo_id));
        CREATE TABLE IF NOT EXISTS Clientes (id VARCHAR(100) PRIMARY KEY, nombre VARCHAR(150) NOT NULL, apellido VARCHAR(150) NOT NULL, telefono VARCHAR(100), provincia VARCHAR(100), localidad VARCHAR(100), direccion VARCHAR(255), membresia_id VARCHAR(100));
        CREATE TABLE IF NOT EXISTS Entradas (id VARCHAR(100) PRIMARY KEY, numero_compra INT NOT NULL, articulo_id VARCHAR(100) NOT NULL, cepa VARCHAR(255), proveedor_id VARCHAR(100) NOT NULL, cantidad_cajas INT NOT NULL, unidades_sumadas INT NOT NULL, precio_caja DOUBLE PRECISION NOT NULL, costo_adicional DOUBLE PRECISION NOT NULL DEFAULT 0, fecha VARCHAR(20));
        CREATE TABLE IF NOT EXISTS Salidas (id VARCHAR(100) PRIMARY KEY, fecha VARCHAR(20), cliente_id VARCHAR(100) NOT NULL, tipo_venta VARCHAR(50) NOT NULL, articulo_id VARCHAR(100) NOT NULL, membresia_id VARCHAR(100), cantidad_botellas INT NOT NULL, detalle VARCHAR(255));
        CREATE TABLE IF NOT EXISTS AuditoriaLogs (id VARCHAR(100) PRIMARY KEY, fecha_hora VARCHAR(50) NOT NULL, usuario VARCHAR(255) NOT NULL, modulo VARCHAR(100) NOT NULL, accion VARCHAR(100) NOT NULL, detalle TEXT);

        ALTER TABLE Membresias ADD COLUMN IF NOT EXISTS tipo VARCHAR(100) DEFAULT 'Selección';
        ALTER TABLE Membresias ADD COLUMN IF NOT EXISTS precio DOUBLE PRECISION DEFAULT 0;
        ALTER TABLE Entradas ADD COLUMN IF NOT EXISTS costo_adicional DOUBLE PRECISION DEFAULT 0;
        ALTER TABLE Entradas ADD COLUMN IF NOT EXISTS fecha VARCHAR(20);
        ALTER TABLE Salidas ADD COLUMN IF NOT EXISTS fecha VARCHAR(20);
        ALTER TABLE Salidas ADD COLUMN IF NOT EXISTS detalle VARCHAR(255);
        ALTER TABLE Usuarios ADD COLUMN IF NOT EXISTS rol VARCHAR(50) DEFAULT 'Admin';
        ALTER TABLE Usuarios ADD COLUMN IF NOT EXISTS fecha_creacion VARCHAR(50);
        """
        cursor.execute(schema_sql)
        conn.commit()
        conn.close()
        print("Tablas de PostgreSQL (Supabase/Neon) inicializadas automáticamente con migraciones.")
    except Exception as e:
        print("Aviso inicializando tablas PostgreSQL:", e)

# Auto-initialize PostgreSQL tables if connected to PostgreSQL
init_postgres_tables_if_needed()

def enable_cors(fn):
    def _enable_cors(*args, **kwargs):
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Origin, Accept, Content-Type, X-Requested-With'
        if request.method == 'OPTIONS':
            return {}
        return fn(*args, **kwargs)
    return _enable_cors

# --- API ENDPOINTS ---

@app.route('/api/health', method=['GET', 'OPTIONS'])
@enable_cors
def health():
    conn = None
    try:
        conn = get_db()
        db_type = "Supabase / PostgreSQL (Nube)" if IS_POSTGRES else "SQL Server 2019 (CavaControlDB)"
        db_host = ""
        if IS_POSTGRES and DATABASE_URL:
            from urllib.parse import urlparse
            parsed = urlparse(DATABASE_URL)
            db_host = parsed.hostname or ""
        return {"status": "ok", "db": db_type, "host": db_host}
    except Exception as e:
        response.status = 500
        return {"status": "error", "message": str(e)}
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

@app.route('/api/auth/login', method=['POST', 'OPTIONS'])
@enable_cors
def auth_login():
    conn = None
    try:
        data = request.json or json.loads(request.body.read().decode('utf-8'))
        email = (data.get('email') or '').strip().lower()
        password = (data.get('password') or '').strip()

        if not email or not password:
            response.status = 400
            return {"success": False, "message": "Debe ingresar correo y contraseña."}

        conn = get_db()
        cursor = conn.cursor()
        db_execute(cursor, "SELECT * FROM Usuarios")
        rows = cursor.fetchall()
        col_names = [desc[0].lower() for desc in cursor.description] if cursor.description else []

        email_idx = col_names.index('email') if 'email' in col_names else 2
        pass_idx = col_names.index('password') if 'password' in col_names else 3
        id_idx = col_names.index('id') if 'id' in col_names else 0
        nombre_idx = col_names.index('nombre') if 'nombre' in col_names else 1
        rol_idx = col_names.index('rol') if 'rol' in col_names else 4

        email_found = False
        matched_user = None

        for r in rows:
            u_email = str(r[email_idx] or '').strip().lower()
            u_pass = str(r[pass_idx] or '').strip()
            if u_email == email:
                email_found = True
                if u_pass == password:
                    matched_user = {
                        "id": str(r[id_idx]),
                        "nombre": str(r[nombre_idx]),
                        "email": str(r[email_idx]),
                        "rol": str(r[rol_idx]) if rol_idx < len(r) else 'Admin'
                    }
                    break

        if matched_user:
            return {"success": True, "user": matched_user}
        elif not email_found:
            response.status = 404
            return {"success": False, "message": "USUARIO INEXISTENTE: El correo electrónico ingresado no existe en la base de datos."}
        else:
            response.status = 401
            return {"success": False, "message": "CONTRASEÑA ERRÓNEA: La contraseña ingresada es incorrecta."}
    except Exception as e:
        print("ERROR login:", traceback.format_exc())
        response.status = 500
        return {"success": False, "message": f"ERROR DE BASE DE DATOS: {str(e)}"}
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

@app.route('/api/auth/register', method=['POST', 'OPTIONS'])
@enable_cors
def auth_register():
    conn = None
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
        db_execute(cursor, "SELECT COUNT(*) FROM Usuarios WHERE LOWER(email) = ?", (email,))
        if cursor.fetchone()[0] > 0:
            response.status = 400
            return {"success": False, "message": "El correo ya se encuentra registrado."}

        user_id = f"usr-{int(datetime.datetime.now().timestamp()*1000)}"
        db_execute(
            cursor,
            "INSERT INTO Usuarios (id, nombre, email, password, rol, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, nombre, email, password, 'Usuario', datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        )
        conn.commit()

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
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

@app.route('/api/db', method=['GET', 'OPTIONS'])
@enable_cors
def get_full_state():
    conn = None
    try:
        conn = get_db()
        cursor = conn.cursor()

        # Usuarios
        db_execute(cursor, "SELECT * FROM Usuarios")
        usr_rows = cursor.fetchall()
        usr_cols = [desc[0].lower() for desc in cursor.description] if cursor.description else []
        
        u_id = usr_cols.index('id') if 'id' in usr_cols else 0
        u_nom = usr_cols.index('nombre') if 'nombre' in usr_cols else 1
        u_em = usr_cols.index('email') if 'email' in usr_cols else 2
        u_pw = usr_cols.index('password') if 'password' in usr_cols else 3
        u_rl = usr_cols.index('rol') if 'rol' in usr_cols else 4
        u_fc = usr_cols.index('fecha_creacion') if 'fecha_creacion' in usr_cols else 5

        usuarios = [{
            "id": str(r[u_id]),
            "nombre": str(r[u_nom]),
            "email": str(r[u_em]),
            "password": str(r[u_pw]),
            "rol": str(r[u_rl]) if u_rl < len(r) else 'Admin',
            "fechaCreacion": str(r[u_fc] if u_fc < len(r) else '')
        } for r in usr_rows]

        # Proveedores
        db_execute(cursor, "SELECT id, nombre, telefono, email FROM Proveedores")
        proveedores = [{"id": str(r[0]), "nombre": str(r[1]), "telefono": str(r[2] or ''), "email": str(r[3] or '')} for r in cursor.fetchall()]

        # Articulos + Proveedores
        db_execute(cursor, "SELECT id, bodega, etiqueta, cepa, uxb FROM Articulos")
        articulos_rows = cursor.fetchall()
        
        db_execute(cursor, "SELECT articulo_id, proveedor_id FROM ArticuloProveedores")
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
        db_execute(cursor, "SELECT id, codigo, descripcion, fecha_desde, fecha_hasta, ganancia, tipo, precio FROM Membresias")
        membresias_rows = cursor.fetchall()

        db_execute(cursor, "SELECT membresia_id, articulo_id, cantidad FROM MembresiaItems")
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
        db_execute(cursor, "SELECT id, nombre, apellido, telefono, provincia, localidad, direccion, membresia_id FROM Clientes")
        clientes = [{
            "id": str(r[0]), "nombre": str(r[1]), "apellido": str(r[2]), "telefono": str(r[3] or ''),
            "provincia": str(r[4] or ''), "localidad": str(r[5] or ''), "direccion": str(r[6] or ''), "membresiaId": str(r[7] or '')
        } for r in cursor.fetchall()]

        # Entradas
        db_execute(cursor, "SELECT id, numero_compra, articulo_id, cepa, proveedor_id, cantidad_cajas, unidades_sumadas, precio_caja, costo_adicional, fecha FROM Entradas")
        entradas = [{
            "id": str(r[0]), "numeroCompra": int(r[1]), "articuloId": str(r[2]), "cepa": str(r[3] or ''),
            "proveedorId": str(r[4]), "cantidadCajas": int(r[5]), "unidadesSumadas": int(r[6]),
            "precioCaja": float(r[7] or 0), "costoAdicionalCaja": float(r[8] or 0) if len(r) > 8 else 0, "fecha": str(r[9] or '') if len(r) > 9 else ''
        } for r in cursor.fetchall()]

        # Salidas
        db_execute(cursor, "SELECT id, fecha, cliente_id, tipo_venta, articulo_id, membresia_id, cantidad_botellas, detalle FROM Salidas")
        salidas = [{
            "id": str(r[0]), "fecha": str(r[1] or ''), "clienteId": str(r[2]), "tipoVenta": str(r[3]),
            "articuloId": str(r[4]), "membresiaId": str(r[5] or ''), "cantidadBotellas": int(r[6]), "detalle": str(r[7] or '')
        } for r in cursor.fetchall()]

        # AuditoriaLogs
        db_execute(cursor, "SELECT id, fecha_hora, usuario, modulo, accion, detalle FROM AuditoriaLogs ORDER BY fecha_hora DESC")
        auditoriaLogs = [{
            "id": str(r[0]), "fechaHora": str(r[1]), "usuario": str(r[2]), "modulo": str(r[3]), "accion": str(r[4]), "detalle": str(r[5] or '')
        } for r in cursor.fetchall()]

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
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

@app.route('/api/db/sync', method=['POST', 'OPTIONS'])
@enable_cors
def sync_full_state():
    conn = None
    try:
        data = request.json
        if not data:
            data = json.loads(request.body.read().decode('utf-8'))

        conn = get_db()
        cursor = conn.cursor()

        # Clear existing tables in safe order
        db_execute(cursor, "DELETE FROM AuditoriaLogs;")
        db_execute(cursor, "DELETE FROM Salidas;")
        db_execute(cursor, "DELETE FROM Entradas;")
        db_execute(cursor, "DELETE FROM Clientes;")
        db_execute(cursor, "DELETE FROM MembresiaItems;")
        db_execute(cursor, "DELETE FROM Membresias;")
        db_execute(cursor, "DELETE FROM ArticuloProveedores;")
        db_execute(cursor, "DELETE FROM Articulos;")
        db_execute(cursor, "DELETE FROM Proveedores;")
        
        # Only clear/insert usuarios if provided
        if 'usuarios' in data and data['usuarios']:
            db_execute(cursor, "DELETE FROM Usuarios;")
            usr_rows = [(
                safe_str(u.get('id')),
                safe_str(u.get('nombre'), 150),
                safe_str(u.get('email'), 255),
                safe_str(u.get('password', '123456'), 255),
                safe_str(u.get('rol', 'Usuario'), 50),
                safe_str(u.get('fechaCreacion', ''), 50)
            ) for u in data.get('usuarios', []) if u.get('id')]
            if usr_rows:
                db_executemany(cursor, "INSERT INTO Usuarios (id, nombre, email, password, rol, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?)", usr_rows)

        # 1. Proveedores Bulk Insert
        prov_rows = [(
            safe_str(p.get('id')),
            safe_str(p.get('nombre'), 255),
            safe_str(p.get('telefono', ''), 100),
            safe_str(p.get('email', ''), 255)
        ) for p in data.get('proveedores', []) if p.get('id')]
        if prov_rows:
            db_executemany(cursor, "INSERT INTO Proveedores (id, nombre, telefono, email) VALUES (?, ?, ?, ?)", prov_rows)

        valid_prov_ids = {p[0] for p in prov_rows}

        # 2. Articulos & ArticuloProveedores Bulk Insert
        art_rows = [(
            safe_str(a.get('id')),
            safe_str(a.get('bodega'), 255),
            safe_str(a.get('etiqueta'), 255),
            safe_str(a.get('cepa'), 255),
            safe_int(a.get('uxb'), 6)
        ) for a in data.get('articulos', []) if a.get('id')]
        if art_rows:
            db_executemany(cursor, "INSERT INTO Articulos (id, bodega, etiqueta, cepa, uxb) VALUES (?, ?, ?, ?, ?)", art_rows)

        valid_art_ids = {a[0] for a in art_rows}

        art_prov_rows = []
        for a in data.get('articulos', []):
            art_id = safe_str(a.get('id'))
            if not art_id or art_id not in valid_art_ids:
                continue
            seen_pids = set()
            for pid in a.get('proveedoresIds', []):
                pid_str = safe_str(pid)
                if pid_str in valid_prov_ids and pid_str not in seen_pids:
                    seen_pids.add(pid_str)
                    art_prov_rows.append((art_id, pid_str))
        if art_prov_rows:
            db_executemany(cursor, "INSERT INTO ArticuloProveedores (articulo_id, proveedor_id) VALUES (?, ?)", art_prov_rows)

        # 3. Membresias & MembresiaItems Bulk Insert
        memb_rows = [(
            safe_str(m.get('id')),
            safe_str(m.get('codigo'), 50),
            safe_str(m.get('descripcion'), 255),
            safe_str(m.get('fechaDesde', ''), 20),
            safe_str(m.get('fechaHasta', ''), 20),
            safe_float(m.get('ganancia'), 40.0),
            safe_str(m.get('tipo', 'Selección'), 100),
            safe_float(m.get('precio'), 0.0)
        ) for m in data.get('membresias', []) if m.get('id')]
        if memb_rows:
            db_executemany(cursor, "INSERT INTO Membresias (id, codigo, descripcion, fecha_desde, fecha_hasta, ganancia, tipo, precio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", memb_rows)

        valid_memb_ids = {m[0] for m in memb_rows}

        memb_items_rows = []
        for m in data.get('membresias', []):
            m_id = safe_str(m.get('id'))
            if not m_id or m_id not in valid_memb_ids:
                continue
            items = m.get('items', [])
            if not items and m.get('articuloId'):
                items = [{"articuloId": m['articuloId'], "cantidad": m.get('cantidad', 1)}]
            seen_items = set()
            for item in items:
                art_id_str = safe_str(item.get('articuloId'))
                if art_id_str and art_id_str in valid_art_ids and art_id_str not in seen_items:
                    seen_items.add(art_id_str)
                    memb_items_rows.append((m_id, art_id_str, safe_int(item.get('cantidad'), 1)))
        if memb_items_rows:
            db_executemany(cursor, "INSERT INTO MembresiaItems (membresia_id, articulo_id, cantidad) VALUES (?, ?, ?)", memb_items_rows)

        # 4. Clientes Bulk Insert
        cli_rows = [(
            safe_str(c.get('id')),
            safe_str(c.get('nombre'), 150),
            safe_str(c.get('apellido'), 150),
            safe_str(c.get('telefono', ''), 100),
            safe_str(c.get('provincia', ''), 100),
            safe_str(c.get('localidad', ''), 100),
            safe_str(c.get('direccion', ''), 255),
            safe_str(c.get('membresiaId'), 100) if c.get('membresiaId') and safe_str(c.get('membresiaId')) in valid_memb_ids else None
        ) for c in data.get('clientes', []) if c.get('id')]
        if cli_rows:
            db_executemany(cursor, "INSERT INTO Clientes (id, nombre, apellido, telefono, provincia, localidad, direccion, membresia_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", cli_rows)

        valid_cli_ids = {c[0] for c in cli_rows}

        # 5. Entradas Bulk Insert
        ent_rows = [(
            safe_str(e.get('id')),
            safe_int(e.get('numeroCompra'), 1),
            safe_str(e.get('articuloId')),
            safe_str(e.get('cepa', ''), 255),
            safe_str(e.get('proveedorId')),
            safe_int(e.get('cantidadCajas'), 1),
            safe_int(e.get('unidadesSumadas'), 0),
            safe_float(e.get('precioCaja'), 0.0),
            safe_float(e.get('costoAdicionalCaja'), 0.0),
            safe_str(e.get('fecha', ''), 20)
        ) for e in data.get('entradas', []) if e.get('id') and safe_str(e.get('articuloId')) in valid_art_ids and safe_str(e.get('proveedorId')) in valid_prov_ids]
        if ent_rows:
            db_executemany(cursor, "INSERT INTO Entradas (id, numero_compra, articulo_id, cepa, proveedor_id, cantidad_cajas, unidades_sumadas, precio_caja, costo_adicional, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ent_rows)

        # 6. Salidas Bulk Insert
        sal_rows = [(
            safe_str(s.get('id')),
            safe_str(s.get('fecha', ''), 20),
            safe_str(s.get('clienteId')),
            safe_str(s.get('tipoVenta', 'Directa'), 50),
            safe_str(s.get('articuloId')),
            safe_str(s.get('membresiaId'), 100) if s.get('membresiaId') and safe_str(s.get('membresiaId')) in valid_memb_ids else None,
            safe_int(s.get('cantidadBotellas'), 1),
            safe_str(s.get('detalle', ''), 255)
        ) for s in data.get('salidas', []) if s.get('id') and safe_str(s.get('clienteId')) in valid_cli_ids and safe_str(s.get('articuloId')) in valid_art_ids]
        if sal_rows:
            db_executemany(cursor, "INSERT INTO Salidas (id, fecha, cliente_id, tipo_venta, articulo_id, membresia_id, cantidad_botellas, detalle) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", sal_rows)

        # 7. AuditoriaLogs Bulk Insert
        audit_rows = [(
            safe_str(log.get('id')),
            safe_str(log.get('fechaHora', ''), 50),
            safe_str(log.get('usuario', ''), 255),
            safe_str(log.get('modulo', ''), 100),
            safe_str(log.get('accion', ''), 100),
            safe_str(log.get('detalle', ''))
        ) for log in data.get('auditoriaLogs', []) if log.get('id')]
        if audit_rows:
            db_executemany(cursor, "INSERT INTO AuditoriaLogs (id, fecha_hora, usuario, modulo, accion, detalle) VALUES (?, ?, ?, ?, ?, ?)", audit_rows)

        conn.commit()
        conn.close()

        db_name_str = "Supabase / PostgreSQL" if IS_POSTGRES else "SQL Server 2019"
        return {"success": True, "message": f"Datos sincronizados masivamente a alta velocidad en {db_name_str}"}

    except Exception as e:
        print("ERROR DURANTE SYNC BULK DB:", traceback.format_exc())
        if conn:
            try:
                conn.rollback()
                conn.close()
            except Exception:
                pass
        response.status = 500
        return {"error": str(e)}

@app.route('/<filename:path>', method=['GET', 'OPTIONS'])
@enable_cors
def serve_static(filename):
    res = static_file(filename, root='.')
    res.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    res.headers['Pragma'] = 'no-cache'
    res.headers['Expires'] = '0'
    return res

@app.route('/', method=['GET', 'OPTIONS'])
@enable_cors
def serve_index():
    res = static_file('index.html', root='.')
    res.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    res.headers['Pragma'] = 'no-cache'
    res.headers['Expires'] = '0'
    return res

if __name__ == '__main__':
    print(f"Iniciando servidor de conexión CavaControl en http://{HOST}:{PORT} ...")
    run(app, host=HOST, port=PORT, quiet=False)
