import pyodbc

CONN_STR = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=. ;"
    "DATABASE=master;"
    "TRUSTED_CONNECTION=yes;"
)

def init_sql_server():
    print("Conectando a Microsoft SQL Server 2019...")
    conn = pyodbc.connect(CONN_STR, autocommit=True)
    cursor = conn.cursor()

    cursor.execute("""
    IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'CavaControlDB')
    BEGIN
        CREATE DATABASE CavaControlDB;
    END
    """)
    conn.close()

    db_conn_str = CONN_STR.replace("DATABASE=master;", "DATABASE=CavaControlDB;")
    conn = pyodbc.connect(db_conn_str, autocommit=True)
    cursor = conn.cursor()

    cursor.execute("""
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Usuarios')
    CREATE TABLE Usuarios (
        id NVARCHAR(100) PRIMARY KEY,
        nombre NVARCHAR(150) NOT NULL,
        email NVARCHAR(255) NOT NULL,
        password NVARCHAR(255) NOT NULL,
        rol NVARCHAR(50) NOT NULL DEFAULT 'Admin',
        fecha_creacion NVARCHAR(50)
    );

    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Proveedores')
    CREATE TABLE Proveedores (
        id NVARCHAR(100) PRIMARY KEY,
        nombre NVARCHAR(255) NOT NULL,
        telefono NVARCHAR(100),
        email NVARCHAR(255)
    );

    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Articulos')
    CREATE TABLE Articulos (
        id NVARCHAR(100) PRIMARY KEY,
        bodega NVARCHAR(255) NOT NULL,
        etiqueta NVARCHAR(255) NOT NULL,
        cepa NVARCHAR(255) NOT NULL,
        uxb INT NOT NULL DEFAULT 6
    );

    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ArticuloProveedores')
    CREATE TABLE ArticuloProveedores (
        articulo_id NVARCHAR(100) NOT NULL,
        proveedor_id NVARCHAR(100) NOT NULL,
        PRIMARY KEY (articulo_id, proveedor_id)
    );

    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Membresias')
    CREATE TABLE Membresias (
        id NVARCHAR(100) PRIMARY KEY,
        tipo NVARCHAR(100) NOT NULL DEFAULT 'Selección',
        codigo NVARCHAR(50) NOT NULL,
        descripcion NVARCHAR(255) NOT NULL,
        fecha_desde NVARCHAR(20),
        fecha_hasta NVARCHAR(20),
        precio FLOAT NOT NULL DEFAULT 0,
        ganancia FLOAT NOT NULL DEFAULT 40
    );

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Membresias') AND name = 'tipo')
    ALTER TABLE Membresias ADD tipo NVARCHAR(100) NOT NULL DEFAULT 'Selección';

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Membresias') AND name = 'precio')
    ALTER TABLE Membresias ADD precio FLOAT NOT NULL DEFAULT 0;

    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'MembresiaItems')
    CREATE TABLE MembresiaItems (
        membresia_id NVARCHAR(100) NOT NULL,
        articulo_id NVARCHAR(100) NOT NULL,
        cantidad INT NOT NULL DEFAULT 1,
        PRIMARY KEY (membresia_id, articulo_id)
    );

    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Clientes')
    CREATE TABLE Clientes (
        id NVARCHAR(100) PRIMARY KEY,
        nombre NVARCHAR(150) NOT NULL,
        apellido NVARCHAR(150) NOT NULL,
        telefono NVARCHAR(100),
        provincia NVARCHAR(100),
        localidad NVARCHAR(100),
        direccion NVARCHAR(255),
        membresia_id NVARCHAR(100)
    );

    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Entradas')
    CREATE TABLE Entradas (
        id NVARCHAR(100) PRIMARY KEY,
        numero_compra INT NOT NULL,
        articulo_id NVARCHAR(100) NOT NULL,
        cepa NVARCHAR(255),
        proveedor_id NVARCHAR(100) NOT NULL,
        cantidad_cajas INT NOT NULL,
        unidades_sumadas INT NOT NULL,
        precio_caja FLOAT NOT NULL,
        costo_adicional FLOAT NOT NULL DEFAULT 0,
        fecha NVARCHAR(20)
    );

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Entradas') AND name = 'costo_adicional')
    ALTER TABLE Entradas ADD costo_adicional FLOAT NOT NULL DEFAULT 0;

    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Salidas')
    CREATE TABLE Salidas (
        id NVARCHAR(100) PRIMARY KEY,
        fecha NVARCHAR(20),
        cliente_id NVARCHAR(100) NOT NULL,
        tipo_venta NVARCHAR(50) NOT NULL,
        articulo_id NVARCHAR(100) NOT NULL,
        membresia_id NVARCHAR(100),
        cantidad_botellas INT NOT NULL,
        detalle NVARCHAR(255)
    );

    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AuditoriaLogs')
    CREATE TABLE AuditoriaLogs (
        id NVARCHAR(100) PRIMARY KEY,
        fecha_hora NVARCHAR(50) NOT NULL,
        usuario NVARCHAR(255) NOT NULL,
        modulo NVARCHAR(100) NOT NULL,
        accion NVARCHAR(100) NOT NULL,
        detalle NVARCHAR(MAX)
    );
    """)

    # Safely drop costo_adicional from Articulos if it exists
    cursor.execute("""
    DECLARE @ConstraintName nvarchar(200)
    SELECT @ConstraintName = Name FROM SYS.DEFAULT_CONSTRAINTS
    WHERE PARENT_OBJECT_ID = OBJECT_ID('Articulos')
    AND PARENT_COLUMN_ID = (SELECT column_id FROM sys.columns WHERE NAME = N'costo_adicional' AND object_id = OBJECT_ID('Articulos'))
    IF @ConstraintName IS NOT NULL
        EXEC('ALTER TABLE Articulos DROP CONSTRAINT ' + @ConstraintName)
    IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Articulos') AND name = 'costo_adicional')
        ALTER TABLE Articulos DROP COLUMN costo_adicional;
    """)

    # Seed default Admin User if table is empty
    cursor.execute("SELECT COUNT(*) FROM Usuarios")
    if cursor.fetchone()[0] == 0:
        cursor.execute(
            "INSERT INTO Usuarios (id, nombre, email, password, rol, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?)",
            ("usr-admin", "Administrador", "admin@cavacontrol.com", "admin123", "Admin", "2026-09-07 00:00:00")
        )
        print("Usuario Admin por defecto creado: admin@cavacontrol.com / admin123")

    print("Tablas de CavaControlDB actualizadas/verificadas en SQL Server 2019.")
    conn.close()

def clear_all_data():
    db_conn_str = CONN_STR.replace("DATABASE=master;", "DATABASE=CavaControlDB;")
    conn = pyodbc.connect(db_conn_str, autocommit=True)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM AuditoriaLogs;")
    cursor.execute("DELETE FROM Salidas;")
    cursor.execute("DELETE FROM Entradas;")
    cursor.execute("DELETE FROM Clientes;")
    cursor.execute("DELETE FROM MembresiaItems;")
    cursor.execute("DELETE FROM Membresias;")
    cursor.execute("DELETE FROM ArticuloProveedores;")
    cursor.execute("DELETE FROM Articulos;")
    cursor.execute("DELETE FROM Proveedores;")
    print("Todos los datos de negocio han sido limpiados de SQL Server 2019.")
    conn.close()

if __name__ == '__main__':
    init_sql_server()
