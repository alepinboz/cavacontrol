-- Schema SQL para CavaControl (PostgreSQL / Supabase / Neon / Render)

CREATE TABLE IF NOT EXISTS Usuarios (
    id VARCHAR(100) PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    rol VARCHAR(50) NOT NULL DEFAULT 'Admin',
    fecha_creacion VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS Proveedores (
    id VARCHAR(100) PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    telefono VARCHAR(100),
    email VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS Articulos (
    id VARCHAR(100) PRIMARY KEY,
    bodega VARCHAR(255) NOT NULL,
    etiqueta VARCHAR(255) NOT NULL,
    cepa VARCHAR(255) NOT NULL,
    uxb INT NOT NULL DEFAULT 6
);

CREATE TABLE IF NOT EXISTS ArticuloProveedores (
    articulo_id VARCHAR(100) NOT NULL,
    proveedor_id VARCHAR(100) NOT NULL,
    PRIMARY KEY (articulo_id, proveedor_id)
);

CREATE TABLE IF NOT EXISTS Membresias (
    id VARCHAR(100) PRIMARY KEY,
    tipo VARCHAR(100) NOT NULL DEFAULT 'Selección',
    codigo VARCHAR(50) NOT NULL,
    descripcion VARCHAR(255) NOT NULL,
    fecha_desde VARCHAR(20),
    fecha_hasta VARCHAR(20),
    precio DOUBLE PRECISION NOT NULL DEFAULT 0,
    ganancia DOUBLE PRECISION NOT NULL DEFAULT 40
);

CREATE TABLE IF NOT EXISTS MembresiaItems (
    membresia_id VARCHAR(100) NOT NULL,
    articulo_id VARCHAR(100) NOT NULL,
    cantidad INT NOT NULL DEFAULT 1,
    PRIMARY KEY (membresia_id, articulo_id)
);

CREATE TABLE IF NOT EXISTS Clientes (
    id VARCHAR(100) PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    apellido VARCHAR(150) NOT NULL,
    telefono VARCHAR(100),
    provincia VARCHAR(100),
    localidad VARCHAR(100),
    direccion VARCHAR(255),
    membresia_id VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS Entradas (
    id VARCHAR(100) PRIMARY KEY,
    numero_compra INT NOT NULL,
    articulo_id VARCHAR(100) NOT NULL,
    cepa VARCHAR(255),
    proveedor_id VARCHAR(100) NOT NULL,
    cantidad_cajas INT NOT NULL,
    unidades_sumadas INT NOT NULL,
    precio_caja DOUBLE PRECISION NOT NULL,
    costo_adicional DOUBLE PRECISION NOT NULL DEFAULT 0,
    fecha VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS Salidas (
    id VARCHAR(100) PRIMARY KEY,
    fecha VARCHAR(20),
    cliente_id VARCHAR(100) NOT NULL,
    tipo_venta VARCHAR(50) NOT NULL,
    articulo_id VARCHAR(100) NOT NULL,
    membresia_id VARCHAR(100),
    cantidad_botellas INT NOT NULL,
    detalle VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS AuditoriaLogs (
    id VARCHAR(100) PRIMARY KEY,
    fecha_hora VARCHAR(50) NOT NULL,
    usuario VARCHAR(255) NOT NULL,
    modulo VARCHAR(100) NOT NULL,
    accion VARCHAR(100) NOT NULL,
    detalle TEXT
);
