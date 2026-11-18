import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

interface Estacion {
  id: number;
  nombre: string;
  orden: number;
  min_desde_lacroze: number;
  min_desde_lemos: number;
}

interface SalidaCabecera {
  id: string;
  sentido: 'Lemos' | 'Lacroze';
  dias_operacion: string;
  hora_salida: string;
  nota: string | null;
}

interface ProximoServicio {
  horaPasoOrigen: string;
  horaLlegadaDestino: string;
  minutosFaltantes: number;
  minutoPasoTotal: number;
  tiempoViaje: number;
  retrasado: boolean;
  nota: string | null;
  minSalidaCabecera?: number;
}

function obtenerDiaOperacionActual(): 'HABILES' | 'SABADOS' | 'DOMINGOS' {
  const dia = new Date().getDay();
  if (dia === 0) return 'DOMINGOS';
  if (dia === 6) return 'SABADOS';
  return 'HABILES';
}

export default function AppTrenUrquiza() {
  const [estaciones, setEstaciones] = useState<Estacion[]>([]);
  const [origenId, setOrigenId] = useState<number>(() => Number(localStorage.getItem('urquiza_origen')) || 23);
  const [destinoId, setDestinoId] = useState<number>(() => Number(localStorage.getItem('urquiza_destino')) || 1);
  const [diaOperacion, setDiaOperacion] = useState<string>(obtenerDiaOperacionActual);
  const [salidas, setSalidas] = useState<SalidaCabecera[]>([]);
  const [proximosTrenes, setProximosTrenes] = useState<ProximoServicio[]>([]);
  const [cargando, setCargando] = useState<boolean>(true);
  
  const [horaFranja, setHoraFranja] = useState<string>(''); // Ej: '17' para la franja de 17:00 a 17:59
  
  const [estadoWeb, setEstadoWeb] = useState({ 
    estadoNormal: true, 
    minutosRetraso: 0, 
    mensaje: 'Servicio operando con normalidad' 
  });
  
  const [horaActualStr, setHoraActualStr] = useState<string>('');

  useEffect(() => {
    const actualizarReloj = () => {
      const ahora = new Date();
      setHoraActualStr(ahora.toLocaleTimeString());
    };
    actualizarReloj();
    const interval = setInterval(actualizarReloj, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    localStorage.setItem('urquiza_origen', String(origenId));
    localStorage.setItem('urquiza_destino', String(destinoId));
  }, [origenId, destinoId]);

  const estacionOrigen = estaciones.find(e => e.id === origenId);
  const estacionDestino = estaciones.find(e => e.id === destinoId);

  const sentidoActual: 'Lemos' | 'Lacroze' =
    estacionOrigen && estacionDestino && estacionOrigen.orden < estacionDestino.orden
      ? 'Lemos'
      : 'Lacroze';

  const invertirRecorrido = () => {
    setOrigenId(destinoId);
    setDestinoId(origenId);
  };

  useEffect(() => {
    async function inicializar() {
      const { data: estData } = await supabase.from('estaciones_urquiza').select('*').order('orden', { ascending: true });
      if (estData) setEstaciones(estData);

      const { data: dbEstado } = await supabase.from('estado_urquiza').select('*').eq('id', 1).single();
      if (dbEstado) {
        setEstadoWeb({
          estadoNormal: dbEstado.estado_normal,
          minutosRetraso: dbEstado.minutos_retraso || 0,
          mensaje: dbEstado.mensaje || 'Servicio operando con normalidad'
        });
      }
    }
    inicializar();
  }, []);

  useEffect(() => {
    async function cargarSalidas() {
      if (estaciones.length === 0) return;
      setCargando(true);
      const { data } = await supabase
        .from('salidas_cabecera')
        .select('*')
        .eq('sentido', sentidoActual)
        .eq('dias_operacion', diaOperacion)
        .order('hora_salida', { ascending: true });

      if (data) setSalidas(data);
      setCargando(false);
    }
    cargarSalidas();
  }, [sentidoActual, diaOperacion, estaciones]);

  // Cálculo de horarios filtrando estrictamente por la franja horaria seleccionada
  useEffect(() => {
    if (!estacionOrigen || !estacionDestino || estacionOrigen.id === estacionDestino.id) {
      setProximosTrenes([]);
      return;
    }

    function calcularHorarios() {
      const ahora = new Date();
      const minActuales = ahora.getHours() * 60 + ahora.getMinutes();
      const demoraTotal = estadoWeb.minutosRetraso;
      const estaRetrasado = !estadoWeb.estadoNormal || demoraTotal > 3;

      const offsetOrigen = sentidoActual === 'Lemos' ? estacionOrigen!.min_desde_lacroze : estacionOrigen!.min_desde_lemos;
      const offsetDestino = sentidoActual === 'Lemos' ? estacionDestino!.min_desde_lacroze : estacionDestino!.min_desde_lemos;
      const tiempoViaje = Math.abs(offsetDestino - offsetOrigen);

      const todosCalculados: ProximoServicio[] = salidas.map(s => {
        const [h, m] = s.hora_salida.split(':').map(Number);
        const minSalidaCabecera = h * 60 + m;
        const minPasoOrigen = minSalidaCabecera + offsetOrigen + demoraTotal;
        const minLlegadaDestino = minSalidaCabecera + offsetDestino + demoraTotal;

        const formatearHora = (totalMin: number) => {
          const horas = Math.floor((totalMin / 60) % 24).toString().padStart(2, '0');
          const mins = (totalMin % 60).toString().padStart(2, '0');
          return `${horas}:${mins}`;
        };

        return {
          horaPasoOrigen: formatearHora(minPasoOrigen),
          horaLlegadaDestino: formatearHora(minLlegadaDestino),
          minutosFaltantes: minPasoOrigen - minActuales,
          minutoPasoTotal: minPasoOrigen,
          tiempoViaje,
          retrasado: estaRetrasado,
          nota: s.nota,
          minSalidaCabecera
        };
      });

      let filtrados: ProximoServicio[] = [];

      if (horaFranja !== '') {
        // Si eligió una hora (ej. '17'), filtramos estrictamente los trenes que pasan entre las 17:00 y las 17:59
        const horaInicioMinutos = Number(horaFranja) * 60;
        const horaFinMinutos = horaInicioMinutos + 59;

        filtrados = todosCalculados
          .filter(item => item.minutoPasoTotal >= horaInicioMinutos && item.minutoPasoTotal <= horaFinMinutos)
          .sort((a, b) => a.minutoPasoTotal - b.minutoPasoTotal);
      } else {
        // Modo en vivo: próximos 4 trenes a partir de ahora
        filtrados = todosCalculados
          .filter(item => item.minutosFaltantes >= 0)
          .sort((a, b) => a.minutosFaltantes - b.minutosFaltantes)
          .slice(0, 4);
      }

      setProximosTrenes(filtrados);
    }

    calcularHorarios();
    const timer = setInterval(calcularHorarios, 10000);
    return () => clearInterval(timer);
  }, [salidas, estacionOrigen, estacionDestino, sentidoActual, estadoWeb, horaFranja]);

  const alertaRetraso = !estadoWeb.estadoNormal || estadoWeb.minutosRetraso > 3;

  const horasDisponibles = Array.from({ length: 24 }, (_, i) => {
    const h = i.toString().padStart(2, '0');
    return { valor: h, etiqueta: `${h}:00 a ${h}:59 hs` };
  });

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0f172a',
      color: '#f8fafc',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '20px',
      position: 'relative'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '520px',
        backgroundColor: '#1e293b',
        borderRadius: '16px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
        border: '3px solid #eab308',
        overflow: 'hidden'
      }}>
        
        {/* Franja superior tricolor estilo frente del tren */}
        <div style={{
          height: '10px',
          background: 'repeating-linear-gradient(45deg, #dc2626, #dc2626 15px, #ffffff 15px, #ffffff 30px)'
        }}></div>

        {/* Encabezado amarillo ferroviario con Reloj en vivo */}
        <div style={{
          backgroundColor: '#eab308',
          color: '#0f172a',
          padding: '16px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '4px solid #0f172a'
        }}>
          <div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ backgroundColor: '#0f172a', color: '#eab308', fontSize: '10px', fontWeight: 900, padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase' }}>Línea Urquiza</span>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#1e293b' }}>🕒 {horaActualStr}</span>
            </div>
            <h1 style={{ fontSize: '20px', fontWeight: 900, margin: '4px 0 0 0', textTransform: 'uppercase' }}>Próximos Trenes</h1>
            <p style={{ fontSize: '10px', fontWeight: 700, margin: 0, opacity: 0.85 }}>Metrovías · Vigencia 2026</p>
          </div>
          <span style={{
            backgroundColor: alertaRetraso ? '#dc2626' : '#065f46',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: '10px',
            fontSize: '11px',
            fontWeight: 900,
            textTransform: 'uppercase'
          }}>
            {alertaRetraso ? `Retrasado (+${estadoWeb.minutosRetraso}m)` : 'En Horario'}
          </span>
        </div>

        <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          
          {/* Reporte Oficial */}
          <div style={{ 
            backgroundColor: alertaRetraso ? 'rgba(220, 38, 38, 0.15)' : '#090d16', 
            border: alertaRetraso ? '1px solid #dc2626' : '1px solid #334155', 
            padding: '12px 14px', 
            borderRadius: '10px', 
            fontSize: '12px', 
            color: alertaRetraso ? '#fca5a5' : '#fbbf24', 
            fontWeight: 600,
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', color: '#94a3b8' }}>Reporte Oficial de Estado:</span>
              {estadoWeb.minutosRetraso > 0 && (
                <span style={{ fontSize: '10px', fontWeight: 900, backgroundColor: '#dc2626', color: '#fff', padding: '1px 6px', borderRadius: '4px' }}>
                  +{estadoWeb.minutosRetraso} min auto
                </span>
              )}
            </div>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: '13px' }}>
              {alertaRetraso ? '⚠️ ' : '✅ '} {estadoWeb.mensaje}
            </span>
          </div>

          {/* Selectores de Estación */}
          <div style={{ backgroundColor: '#090d16', border: '1px solid #334155', borderRadius: '12px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 800, color: '#eab308', textTransform: 'uppercase' }}>📍 Subo en estación (Origen)</label>
              <select
                value={origenId}
                onChange={e => setOrigenId(Number(e.target.value))}
                style={{ width: '100%', marginTop: '6px', backgroundColor: '#1e293b', border: '2px solid #475569', borderRadius: '8px', padding: '10px', color: '#fff', fontSize: '13px', fontWeight: 700, outline: 'none' }}
              >
                {estaciones.map(est => (<option key={est.id} value={est.id}>{est.nombre}</option>))}
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', margin: '-6px 0' }}>
              <button
                type="button"
                onClick={invertirRecorrido}
                style={{ backgroundColor: '#eab308', color: '#0f172a', border: '2px solid #0f172a', borderRadius: '20px', padding: '6px 16px', fontSize: '11px', fontWeight: 900, cursor: 'pointer', textTransform: 'uppercase' }}
              >
                ⇅ Invertir Recorrido
              </button>
            </div>

            <div>
              <label style={{ fontSize: '11px', fontWeight: 800, color: '#eab308', textTransform: 'uppercase' }}>🏁 Voy hasta (Destino)</label>
              <select
                value={destinoId}
                onChange={e => setDestinoId(Number(e.target.value))}
                style={{ width: '100%', marginTop: '6px', backgroundColor: '#1e293b', border: '2px solid #475569', borderRadius: '8px', padding: '10px', color: '#fff', fontSize: '13px', fontWeight: 700, outline: 'none' }}
              >
                {estaciones.map(est => (<option key={est.id} value={est.id}>{est.nombre}</option>))}
              </select>
            </div>
          </div>

          {/* DIAGRAMA ESTILO SUBTE CON TIEMPO ESTIMADO */}
          {estacionOrigen && estacionDestino && origenId !== destinoId && (() => {
            const offsetOrg = sentidoActual === 'Lemos' ? estacionOrigen.min_desde_lacroze : estacionOrigen.min_desde_lemos;
            const offsetDst = sentidoActual === 'Lemos' ? estacionDestino.min_desde_lacroze : estacionDestino.min_desde_lemos;
            const tiempoTotalViaje = Math.abs(offsetDst - offsetOrg);
            const cantEstaciones = Math.abs(estacionDestino.orden - estacionOrigen.orden);

            return (
              <div style={{ backgroundColor: '#090d16', border: '1px solid #334155', borderRadius: '12px', padding: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 900, color: '#eab308', textTransform: 'uppercase' }}>
                    🗺️ Esquema de Recorrido
                  </span>
                  <span style={{ fontSize: '11px', fontWeight: 900, backgroundColor: 'rgba(234, 179, 8, 0.15)', color: '#eab308', padding: '2px 8px', borderRadius: '6px', border: '1px solid rgba(234, 179, 8, 0.3)' }}>
                    ⏱️ ~{tiempoTotalViaje} min de viaje ({cantEstaciones} est.)
                  </span>
                </div>

                <div style={{ position: 'relative', margin: '20px 10px 10px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ position: 'absolute', top: '50%', left: '0', right: '0', height: '4px', backgroundColor: '#eab308', transform: 'translateY(-50%)', zIndex: 1 }}></div>

                  <div style={{ zIndex: 2, textAlign: 'center', background: '#090d16', padding: '0 4px' }}>
                    <div style={{ width: '14px', height: '14px', backgroundColor: '#3b82f6', border: '3px solid #fff', borderRadius: '50%', margin: '0 auto 4px auto' }}></div>
                    <span style={{ fontSize: '9px', fontWeight: 800, color: '#60a5fa', display: 'block', maxWidth: '90px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{estacionOrigen.nombre}</span>
                  </div>

                  <div style={{ zIndex: 2, backgroundColor: '#1e293b', border: '1px solid #475569', padding: '2px 8px', borderRadius: '6px', fontSize: '9px', fontWeight: 800, color: '#eab308' }}>
                    {sentidoActual === 'Lemos' ? '➔ Lemos' : '➔ Lacroze'}
                  </div>

                  <div style={{ zIndex: 2, textAlign: 'center', background: '#090d16', padding: '0 4px' }}>
                    <div style={{ width: '14px', height: '14px', backgroundColor: '#ef4444', border: '3px solid #fff', borderRadius: '50%', margin: '0 auto 4px auto' }}></div>
                    <span style={{ fontSize: '9px', fontWeight: 800, color: '#f87171', display: 'block', maxWidth: '90px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{estacionDestino.nombre}</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Opciones de cronograma y selector de franja horaria */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={{ backgroundColor: '#090d16', padding: '10px', borderRadius: '10px', border: '1px solid #334155' }}>
              <label style={{ fontSize: '10px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>Cronograma</label>
              <select
                value={diaOperacion}
                onChange={e => setDiaOperacion(e.target.value)}
                style={{ width: '100%', marginTop: '4px', backgroundColor: '#1e293b', color: '#fff', border: '1px solid #475569', borderRadius: '6px', padding: '6px', fontSize: '11px', fontWeight: 700 }}
              >
                <option value="HABILES">Lunes a Viernes</option>
                <option value="SABADOS">Sábados</option>
                <option value="DOMINGOS">Domingos / Feriados</option>
              </select>
            </div>

            <div style={{ backgroundColor: '#090d16', padding: '10px', borderRadius: '10px', border: '1px solid #334155' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '10px', fontWeight: 800, color: '#eab308', textTransform: 'uppercase' }}>Franja Horaria</label>
                {horaFranja !== '' && (
                  <button 
                    onClick={() => setHoraFranja('')} 
                    style={{ fontSize: '9px', background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontWeight: 700 }}
                    title="Volver a hora actual en vivo"
                  >
                    [En vivo]
                  </button>
                )}
              </div>
              <select
                value={horaFranja}
                onChange={e => setHoraFranja(e.target.value)}
                style={{ width: '100%', marginTop: '4px', backgroundColor: '#1e293b', color: '#fbbf24', border: '1px solid #475569', borderRadius: '6px', padding: '6px', fontSize: '11px', fontWeight: 800, outline: 'none' }}
              >
                <option value="">🕒 Hora actual (En vivo)</option>
                {horasDisponibles.map(h => (
                  <option key={h.valor} value={h.valor}>Ver franja {h.etiqueta}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Listado de Trenes de la Franja */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
            {cargando ? (
              <div style={{ padding: '20px', textAlign: 'center', fontSize: '12px', color: '#eab308', fontWeight: 700 }}>
                Consultando cronograma...
              </div>
            ) : proximosTrenes.length > 0 ? (
              proximosTrenes.map((tren, idx) => (
                <div key={idx} style={{
                  backgroundColor: idx === 0 && horaFranja === '' ? '#0f172a' : '#090d16',
                  border: idx === 0 && horaFranja === '' ? '2px solid #eab308' : '1px solid #334155',
                  borderRadius: '12px',
                  padding: '14px',
                  boxShadow: idx === 0 && horaFranja === '' ? '0 4px 12px rgba(234, 179, 8, 0.15)' : 'none'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 900, color: '#eab308', textTransform: 'uppercase' }}>
                      {horaFranja !== '' ? `🚂 Tren #${idx + 1} de la franja` : (idx === 0 ? '🚂 Próxima Formación' : `Siguiente #${idx + 1}`)}
                    </span>
                    <span style={{
                      fontSize: '10px',
                      fontWeight: 900,
                      padding: '2px 8px',
                      borderRadius: '6px',
                      backgroundColor: tren.retrasado ? '#dc2626' : 'rgba(16, 185, 129, 0.2)',
                      color: tren.retrasado ? '#fff' : '#34d399',
                      border: tren.retrasado ? 'none' : '1px solid rgba(16, 185, 129, 0.4)'
                    }}>
                      {tren.retrasado ? 'Retrasado' : 'A Tiempo'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div>
                      {horaFranja === '' && tren.minutosFaltantes === 0 ? (
                        <span style={{ fontSize: '20px', fontWeight: 900, color: '#eab308' }}>EN ANDÉN</span>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                          <span style={{ fontSize: '26px', fontWeight: 900, color: '#fff', lineHeight: 1 }}>{tren.horaPasoOrigen}</span>
                          <span style={{ fontSize: '12px', fontWeight: 800, color: '#eab308' }}>hs</span>
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '12px', fontWeight: 900, color: '#eab308' }}>
                        {horaFranja === '' ? `Faltan ${tren.minutosFaltantes} min` : `Paso en estación`}
                      </div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>Llega: {tren.horaLlegadaDestino} hs ({tren.tiempoViaje} min viaje)</div>
                    </div>
                  </div>

                  {tren.nota && (
                    <div style={{ marginTop: '8px', fontSize: '11px', fontWeight: 700, color: '#fef08a', backgroundColor: 'rgba(234, 179, 8, 0.2)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(234, 179, 8, 0.4)' }}>
                      ⚠️ {tren.nota}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: '#94a3b8', backgroundColor: '#090d16', borderRadius: '10px', border: '1px solid #334155' }}>
                No hay servicios programados en esta franja horaria para este sentido.
              </div>
            )}
          </div>
        </div>

        {/* Franja inferior tricolor */}
        <div style={{
          height: '10px',
          background: 'repeating-linear-gradient(45deg, #dc2626, #dc2626 15px, #ffffff 15px, #ffffff 30px)'
        }}></div>

      </div>
    </div>
  );
}