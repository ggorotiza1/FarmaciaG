const express = require('express');
const { Pool } = require('pg');
const app = express();
const port = process.env.PORT || 3000;

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


// Ruta para obtener los productos
// app.get('/productos-disponibles', async (req, res) => {
//   try {
//     const result = await pool.query('SELECT pro_id, pro_nombre, pro_descripcion, pro_ruta, pro_estado, pro_precio, pro_stock FROM public.productos where pro_estado="Activo"');
//     res.json(result.rows);
//   } catch (err) {
//     console.error('Error al obtener los productos', err);
//     res.status(500).send('Error al obtener los productos');
//   }
// });

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
      if (password === user.user_contrasenia) {  // Comparación directa de la contraseña en texto plano
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

// Verificar JWT (protege las rutas)
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(403).send('Token no proporcionado');

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).send('Token inválido');
    req.userId = decoded.userId;
    next();
  });
};

// Ruta protegida (solo accesible con token válido)
app.get('/protected', verifyToken, (req, res) => {
  res.send('Acceso concedido a contenido protegido');
});

app.post('/comprar', async (req, res) => {
  const { pro_id, cantidad } = req.body;

  // Validar que se proporcionen los datos necesarios
  //console.log(`Datos recibidos: pro_id = ${pro_id}, cantidad = ${cantidad}`);
  if (!pro_id || !cantidad) {
    return res.status(400).send('ID de producto y cantidad son requeridos.');
  }

  try {
    const stockResult = await pool.query('SELECT pro_stock FROM public.productos WHERE pro_id = $1', [pro_id]);

    if (stockResult.rows.length === 0) {
      //console.log('Producto no encontrado');
      return res.status(404).send('Producto no encontrado.');
    }

    const stockActual = stockResult.rows[0].pro_stock;
    //console.log(`Stock actual: ${stockActual}`);

    if (cantidad > stockActual) {
      //console.log('No hay suficiente stock disponible');
      return res.status(400).send('No hay suficiente stock disponible.');
    }

    await pool.query('UPDATE public.productos SET pro_stock = pro_stock - $1 WHERE pro_id = $2', [cantidad, pro_id]);
    //console.log('Compra realizada con éxito');
    res.status(200).send('Compra realizada con éxito.');
  } catch (err) {
    //console.error('Error al realizar la compra', err);
    res.status(500).send('Error al realizar la compra');
  }
});

// Endpoint para actualizar el stock
app.post('/actualizar-stock', async (req, res) => {
  const { pro_id, cantidad } = req.body;

  // Validación básica
  if (!pro_id || !cantidad) {
      return res.status(400).json({ mensaje: 'Faltan datos: pro_id y cantidad son requeridos.' });
  }

  try {
      // Actualizar el stock en la base de datos
      const query = 'UPDATE public.productos SET pro_stock = pro_stock + $1 WHERE pro_id = $2 RETURNING *';
      const values = [cantidad, pro_id];
      
      const result = await pool.query(query, values);
      
      // Verifica si se actualizó algún registro
      if (result.rowCount === 0) {
          return res.status(404).json({ mensaje: 'Producto no encontrado.' });
      }

      return res.json({ mensaje: 'Stock actualizado con éxito.', producto: result.rows[0] });
  } catch (error) {
      console.error('Error al actualizar el stock:', error);
      return res.status(500).json({ mensaje: 'Error al actualizar el stock. Intenta nuevamente.' });
  }
});

// Iniciar el servidor
app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});
