const express = require('express');
const { Pool } = require('pg');
const app = express();
const port = process.env.PORT || 3000;
const cors = require('cors');
app.use(cors());

// Configura la conexión a PostgreSQL
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'Farmacia',
  password: 'administrador',
  port: 5432,
});

// Middleware para permitir el acceso desde el frontend (CORS)s
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.use(cors({
  origin: 'http://127.0.0.1:5500', // Permitir solo este origen
  allowedHeaders: ['Content-Type', 'Authorization'], // Permitir estos encabezados
}));


// Ruta para obtener los productos
app.get('/productos', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT pro_id, pro_nombre, pro_descripcion, pro_ruta, pro_estado, pro_precio, pro_stock 
      FROM public.productos 
      ORDER BY pro_id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener los productos', err);
    res.status(500).send('Error al obtener los productos');
  }
});

// Ruta para obtener los usuarios
app.get('/usuarios', async (req, res) => {
  try {
    const result = await pool.query('SELECT user_id, user_cedula, user_nombre, user_apellido, user_correo, "user_foto-url", user_rol FROM public.usuario');
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener los usuarios', err);
    res.status(500).send('Error al obtener los usuarios');
  }
});

const jwt = require('jsonwebtoken');
app.use(express.json());

const JWT_SECRET = '9RKmhLewPwW9vMyf-oFYU9Uh2-JwvrmfvSDciv9SK-CQtVGe3YyZ4yy5Kr4HhbSP';

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM usuario WHERE user_correo = $1', [username]);
    const user = result.rows[0];

    if (user) {
      if (password === user.user_contrasenia) {
        const token = jwt.sign({ userId: user.user_id }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
      } else {
        res.status(401).send('Credenciales incorrectas');
      }
    } else {
      res.status(404).send('Usuario no encontrado');
    }
  } catch (error) {
    console.error('Error al autenticar al usuario', error);
    res.status(500).send('Error interno del servidor');
  }
});

// Verificar JWT 
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(403).send('Token no proporcionado');

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).send('Token inválido');
    req.userId = decoded.userId;
    next();
  });
};

// Ruta protegida
app.get('/protected', verifyToken, (req, res) => {
  res.send('Acceso concedido a contenido protegido');
});

app.post('/comprar', async (req, res) => {
  const { pro_id, cantidad } = req.body;

  if (!pro_id || !cantidad) {
    return res.status(400).send('ID de producto y cantidad son requeridos.');
  }

  try {
    const stockResult = await pool.query('SELECT pro_stock FROM public.productos WHERE pro_id = $1', [pro_id]);

    if (stockResult.rows.length === 0) {
      return res.status(404).send('Producto no encontrado.');
    }

    const stockActual = stockResult.rows[0].pro_stock;

    if (cantidad > stockActual) {
      return res.status(400).send('No hay suficiente stock disponible.');
    }

    await pool.query('UPDATE public.productos SET pro_stock = pro_stock - $1 WHERE pro_id = $2', [cantidad, pro_id]);
    res.status(200).send('Compra realizada con éxito.');
  } catch (err) {
    res.status(500).send('Error al realizar la compra');
  }
});

// Actualizar el stock
app.post('/actualizar-stock', async (req, res) => {
  const { pro_id, cantidad } = req.body;

  if (!pro_id || !cantidad) {
    return res.status(400).json({ mensaje: 'Faltan datos: pro_id y cantidad son requeridos.' });
  }

  try {
    const query = 'UPDATE public.productos SET pro_stock = pro_stock + $1 WHERE pro_id = $2 RETURNING *';
    const values = [cantidad, pro_id];

    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ mensaje: 'Producto no encontrado.' });
    }

    return res.json({ mensaje: 'Stock actualizado con éxito.', producto: result.rows[0] });
  } catch (error) {
    console.error('Error al actualizar el stock:', error);
    return res.status(500).json({ mensaje: 'Error al actualizar el stock. Intenta nuevamente.' });
  }
});

// Ruta para almacenar facturas
app.post('/facturas', async (req, res) => {
  const { userId, productos } = req.body;

  if (!userId || !productos || productos.length === 0) {
    return res.status(400).send('Se requieren userId y productos.');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const totalFactura = productos.reduce((total, producto) => total + (producto.precio * producto.cantidad), 0);
    const facturaResult = await client.query(
      'INSERT INTO facturas (user_id, total) VALUES ($1, $2) RETURNING factura_id',
      [userId, totalFactura]
    );

    const facturaId = facturaResult.rows[0].factura_id;

    for (const producto of productos) {
      await client.query(
        'INSERT INTO detalle_factura (factura_id, producto_id, nombre_producto, cantidad, precio_unitario) VALUES ($1, $2, $3, $4, $5)',
        [facturaId, producto.id, producto.nombre, producto.cantidad, producto.precio]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Factura almacenada con éxito.', facturaId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al almacenar la factura:', err);
    res.status(500).send('Error al almacenar la factura');
  } finally {
    client.release();
  }
});

app.get('/ver-facturas', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        f.factura_id, 
        f.total, 
        f.fecha, 
        f.estado,
        u.user_id, 
        u.user_nombre, 
        u.user_apellido
      FROM facturas f
      JOIN usuario u ON f.user_id = u.user_id
      ORDER BY f.factura_id ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener facturas', error);
    res.status(500).json({ error: 'Error al obtener las facturas' });
  }
});

app.get('/ver-factura/:id', async (req, res) => {
  const facturaId = parseInt(req.params.id);

  try {
    const result = await pool.query(`SELECT 
    f.factura_id,
    f.fecha,
    f.total,
    f.estado,
    u.user_id,
    u.user_cedula,
    u.user_nombre,
    u.user_apellido,
    u.user_correo,
    u."user_foto-url",
    u.user_rol,
    u.user_estado,
    json_agg(
        json_build_object(
            'producto_id', d.producto_id,
            'nombre_producto', d.nombre_producto,
            'cantidad', d.cantidad,
            'precio_unitario', d.precio_unitario,
            'subtotal', d.subtotal
        )
    ) AS productos
FROM 
    facturas f
JOIN 
    usuario u ON f.user_id = u.user_id
JOIN 
    detalle_factura d ON f.factura_id = d.factura_id
WHERE 
    f.factura_id = $1 -- Aquí se reemplaza $1 con el ID específico de la factura que deseas obtener
GROUP BY 
    f.factura_id, u.user_id;

`, [facturaId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }


    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al obtener la factura:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Iniciar el servidor
app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});
