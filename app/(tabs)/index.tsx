import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  ImageBackground,
  Keyboard,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';

// --- INICIO: Tipos sugeridos ---
interface Coords {
  lat: number;
  lon: number;
}

// Tipos basados en la respuesta de la API de OpenWeather
interface WeatherData {
  coord: Coords;
  weather: { main: string; description: string }[];
  main: {
    temp: number;
    feels_like: number;
    humidity: number;
    pressure: number;
  };
  visibility: number;
  wind: { speed: number };
  clouds: { all: number };
  name: string;
}

interface ForecastAPIItem {
  dt: number;
  main: { temp_min: number; temp_max: number; };
  weather: { main: string; description: string; }[];
}

type ForecastAPIList = ForecastAPIItem[];

interface ForecastItem {
  dt: number;
  main: string;
  desc: string;
  temp_min: number;
  temp_max: number;
}

interface HourlyData {
  labels: string[];
  datasets: { data: number[] }[];
  icons: React.ComponentProps<typeof Ionicons>['name'][];
}

// --- FIN: Tipos sugeridos ---

import Constants from 'expo-constants';
import LottieView from 'lottie-react-native';
// Lee tu API key desde extra de Expo (compatible web y móvil)
const API_KEY = Constants.expoConfig?.extra?.EXPO_PUBLIC_OPENWEATHER_API_KEY || process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY;
// Endpoints de OpenWeather (Current + Forecast 5 días/3h)
const CURRENT_URL = 'https://api.openweathermap.org/data/2.5/weather';
const FORECAST_URL = 'https://api.openweathermap.org/data/2.5/forecast';

export default function WeatherScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState('light'); // 'light' | 'dark'
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [units, setUnits] = useState('metric'); // 'metric' (°C) | 'imperial' (°F)
  const [query, setQuery] = useState('');       // búsqueda

  const [coords, setCoords] = useState<Coords | null>(null);   // { lat, lon }
  const [cityLabel, setCityLabel] = useState(''); // nombre de ciudad mostrado

  const [current, setCurrent] = useState<WeatherData | null>(null);   // datos actuales
  const [forecast, setForecast] = useState<ForecastItem[]>([]);   // lista compacta
  const [hourlyForecast, setHourlyForecast] = useState<HourlyData | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const unitSymbol = units === 'metric' ? '°C' : '°F';
  const speedLabel = units === 'metric' ? 'm/s' : 'mph';
  const isDark = theme === 'dark';
  const { width } = useWindowDimensions();

  // Estilos dinámicos para el tema
  const dynamicStyles = {
    container: {
      backgroundColor: isDark ? '#121212' : '#f5f7fb',
    },
    card: {
      backgroundColor: isDark ? '#1E1E1E' : '#fff',
    },
    text: {
      color: isDark ? '#E0E0E0' : '#333',
    },
  };

  const canFetch = useMemo(() => Boolean(API_KEY), [API_KEY]);

  useEffect(() => {
    if (!loading) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }).start();
    }
  }, [loading]);

  useEffect(() => {
    (async () => {
      await initByGeolocation();
    })();
  }, []);

  // Inicializa por geolocalización
  const initByGeolocation = async () => {
    setError(null);
    setLoading(true);
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Permiso de ubicación denegado');
        setLoading(false);
        return;
      }
      let location = await Location.getCurrentPositionAsync({});
      const lat = location.coords.latitude;
      const lon = location.coords.longitude;
      setCoords({ lat, lon });
      await fetchAll({ lat, lon });
    } catch (e) {
      setError('No se pudo obtener la ubicación actual');
    } finally {
      setLoading(false);
    }
  };

  // Buscar por ciudad
  const searchByCity = async () => {
    if (!query.trim()) return;
    setError(null);
    setLoading(true);
    Keyboard.dismiss();
    try {
      // Si no, usamos la query de búsqueda.
      const currentUrl = `${CURRENT_URL}?q=${encodeURIComponent(query)}&appid=${API_KEY}&units=metric&lang=es`;
      const cRes = await fetch(currentUrl);
      const cData = await cRes.json();
      if (!cRes.ok) throw new Error(cData?.message || 'Error al buscar ciudad');

      // Al buscar por ciudad, reseteamos las coordenadas de geolocalización.
      setCoords(null);

      // Usamos los datos actuales y solo buscamos el pronóstico
      setCurrent(cData);
      setCityLabel(cData?.name || '');
      const { lat, lon } = cData.coord;

      const forecastUrl = `${FORECAST_URL}?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&lang=es`;
      const fRes = await fetch(forecastUrl);
      const fData = await fRes.json();
      if (!fRes.ok) throw new Error(fData?.message || 'Error en pronóstico');

      const compact = compactForecast(fData?.list || []);
      setForecast(compact);

      const hourly = processHourlyForecast(fData?.list || []);
      setHourlyForecast(hourly);
    } catch (e) {
      setError('No se encontró la ciudad. Intenta con otro nombre.');
    } finally {
      setLoading(false);
    }
  };

  // Cambiar unidades
  const toggleUnits = () => {
    setUnits((prev) => (prev === 'metric' ? 'imperial' : 'metric'));
  };

  // Refresco (pull to refresh)
  const onRefresh = async () => {
    setRefreshing(true);
    await refreshData();
    setRefreshing(false);
  };

  // Función unificada para refrescar datos
  const refreshData = async () => {
    if (!coords && !query) return;
    setLoading(true);
    setError(null);
    try {
      // Si tenemos coordenadas (geolocalización), las usamos. Si no, buscamos por la última ciudad.
      if (coords) { await fetchAll(coords); }
      else { await searchByCity(); }
    } finally {
      setLoading(false);
    }
  };

  // Descarga current + forecast y normaliza pronóstico a 5 "bloques" aprox
  const fetchAll = async ({ lat, lon }: Coords) => {
    if (!canFetch) {
      setError('Falta la API Key (EXPO_PUBLIC_OPENWEATHER_API_KEY).');
      return;
    }
    try {
      const currentUrl = `${CURRENT_URL}?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&lang=es`;
      const forecastUrl = `${FORECAST_URL}?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&lang=es`;

      const [cRes, fRes] = await Promise.all([fetch(currentUrl), fetch(forecastUrl)]);
      const [cData, fData] = await Promise.all([cRes.json(), fRes.json()]);

      if (!cRes.ok) throw new Error(cData?.message || 'Error en clima actual');
      if (!fRes.ok) throw new Error(fData?.message || 'Error en pronóstico');

      setCurrent(cData);
      setCityLabel(cData?.name || '');

      // Compactar pronóstico a ~5 puntos: uno por día (aprox al mediodía)
      const compact = compactForecast(fData?.list || []);
      setForecast(compact);

      const hourly = processHourlyForecast(fData?.list || []);
      setHourlyForecast(hourly);
    } catch (e) {
      setError('Error al obtener datos del clima. Revisa conexión o API key.');
    }
  };

  const compactForecast = (list: ForecastAPIList): ForecastItem[] => {
    // Agrupa los pronósticos por día y calcula min/max
    const byDay: { [key: string]: any } = {};
    list.forEach((item: ForecastAPIItem) => {
      const dt = new Date(item.dt * 1000);
      const dayKey = dt.toDateString();

      if (!byDay[dayKey]) {
        byDay[dayKey] = {
          dt: item.dt,
          temp_min: item.main.temp_min,
          temp_max: item.main.temp_max,
          weather: item.weather[0], // Usar el primer clima del día como representativo
        };
      } else {
        // Actualizar min y max
        byDay[dayKey].temp_min = Math.min(byDay[dayKey].temp_min, item.main.temp_min);
        byDay[dayKey].temp_max = Math.max(byDay[dayKey].temp_max, item.main.temp_max);
      }
    });

    return Object.values(byDay)
      .sort((a, b) => a.dt - b.dt)
      .slice(0, 5)
      .map((it: any) => ({
        dt: it.dt,
        main: it.weather?.main ?? '',
        desc: it.weather?.description ?? '',
        temp_min: it.temp_min,
        temp_max: it.temp_max,
      }));
  };

  const processHourlyForecast = (list: ForecastAPIList): HourlyData | null => {
    if (!list || list.length === 0) return null;

    // Próximas 24h = 8 intervalos de 3h
    const next24h: ForecastAPIList = list.slice(0, 8);
    if (next24h.length < 2) return null; // Necesitamos al menos 2 puntos

    const labels = next24h.map(item => {
      const dt = new Date(item.dt * 1000);
      return `${dt.getHours()}:00`;
    });

    const data = next24h.map(item => Math.round(item.main.temp_max));
    const icons = next24h.map(item => getWeatherIcon(item.weather[0]?.main));

    return { labels, datasets: [{ data }], icons };
  };

  // --- Funciones de conversión ---
  const displayTemp = (temp: number) => {
    const t = units === 'imperial' ? (temp * 9/5) + 32 : temp;
    return Math.round(t);
  };

  const displaySpeed = (speed: number) => {
    const s = units === 'imperial' ? speed * 2.237 : speed;
    // Devolver con un decimal para mayor precisión en mph
    return s.toFixed(1);
  };

  const getWeatherIcon = (weatherMain: string | undefined): React.ComponentProps<typeof Ionicons>['name'] => {
    const map: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
      Clear: 'sunny',
      Clouds: 'cloudy',
      Rain: 'rainy',
      Snow: 'snow',
      Thunderstorm: 'thunderstorm',
      Drizzle: 'rainy-outline',
      Mist: 'cloudy-outline',
      Smoke: 'cloudy-outline',
      Haze: 'cloudy-outline',
      Dust: 'cloudy-outline',
      Fog: 'cloudy-outline',
      Sand: 'cloudy-outline',
      Ash: 'cloudy-outline',
      Squall: 'rainy-outline',
      Tornado: 'thunderstorm',
    };
    return map[String(weatherMain)] || 'partly-sunny';
  };
  
  const getWeatherImage = (weatherMain: string | undefined) => {
    const map: Record<string, { uri: string }> = {
      Clear: { uri: 'https://images.unsplash.com/photo-1541119638723-c51cbe2262aa?q=80&w=2070&auto=format&fit=crop' },
      Clouds: { uri: 'https://images.unsplash.com/photo-1501630834273-4b5604d2ee31?q=80&w=2070&auto=format&fit=crop' },
      Rain: { uri: 'https://images.unsplash.com/photo-1515694346937-94d85e41e622?q=80&w=1974&auto=format&fit=crop' },
      Snow: { uri: 'https://images.unsplash.com/photo-1491002052546-bf38f186af56?q=80&w=2070&auto=format&fit=crop' },
      Thunderstorm: { uri: 'https://images.unsplash.com/photo-1605727226424-ad25e2d00e69?q=80&w=1974&auto=format&fit=crop' },
      Drizzle: { uri: 'https://images.unsplash.com/photo-1556485671-85b8a7f0e4a7?q=80&w=1974&auto=format&fit=crop' },
      Mist: { uri: 'https://images.unsplash.com/photo-1485236715568-ddc5ee6ca227?q=80&w=1974&auto=format&fit=crop' },
    };
    // Imagen por defecto si no se encuentra una coincidencia
    return map[String(weatherMain)] || { uri: 'https://images.unsplash.com/photo-1614483433234-5a715a4c4b32?q=80&w=1974&auto=format&fit=crop' };
  };

  if (loading) {
    return (
      <View style={[styles.centerContainer, dynamicStyles.container]}>
        <LottieView source={require('../../assets/animations/weather-loading.json')} autoPlay loop style={{ width: 200, height: 200 }} />
        <Text style={[styles.muted, dynamicStyles.text, { marginTop: 0 }]}>
          Obteniendo datos del clima…
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.centerContainer, dynamicStyles.container]}>
        <Ionicons name="alert-circle" size={48} color="tomato" />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity onPress={initByGeolocation} style={styles.primaryBtn}>
          <Ionicons name="locate" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Reintentar con mi ubicación</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.flexOne, dynamicStyles.container]}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      keyboardShouldPersistTaps="handled"
    >
      {/* Búsqueda por ciudad */}
      <View style={styles.controlsContainer}>
        <TextInput
          placeholder="Buscar ciudad "
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={searchByCity}
          returnKeyType="search"
          style={[
            styles.input,
            isDark && styles.inputDark,
          ]}
          placeholderTextColor={isDark ? '#888' : '#aaa'}
        />
        <View style={styles.searchActions}>
          <TouchableOpacity onPress={searchByCity} style={styles.iconBtn}>
            <Ionicons name="search" size={20} />
          </TouchableOpacity>
          <TouchableOpacity onPress={initByGeolocation} style={styles.iconBtn}>
            <Ionicons name="locate" size={20} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setInfoModalVisible(true)} style={styles.iconBtn}>
            <Ionicons name="information-circle-outline" size={22} />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.switchesContainer}>
        <View style={styles.switchRow}>
          <Ionicons name="sunny" size={20} color={isDark ? '#888' : '#333'} />
          <Switch
            value={isDark}
            onValueChange={() => setTheme(isDark ? 'light' : 'dark')}
            trackColor={{ false: '#d8dbe3', true: '#3e3e3e' }}
            thumbColor={isDark ? '#007AFF' : '#f4f3f4'}
          />
          <Ionicons name="moon" size={16} color={isDark ? '#81b0ff' : '#888'} />
        </View>
        <View style={styles.switchRow}>
          <Text style={[styles.switchLabel, dynamicStyles.text]}>°C</Text>
          <Switch
            value={units === 'imperial'}
            onValueChange={toggleUnits}
            trackColor={{ false: '#d8dbe3', true: '#81b0ff' }}
            thumbColor={units === 'imperial' ? '#007AFF' : '#f4f3f4'}
          />
          <Text style={[styles.switchLabel, dynamicStyles.text]}>°F</Text>
        </View>
      </View>

      <Animated.View style={{ opacity: fadeAnim }}>
        {/* Clima actual */}
        {current && (
          <ImageBackground
            source={getWeatherImage(current.weather?.[0]?.main)}
            style={styles.card}
            imageStyle={styles.cardImage}
            resizeMode="cover"
          >
            <View style={styles.cardOverlay}>
              <View style={styles.rowCenter}>
                <Ionicons
                  name={getWeatherIcon(current.weather?.[0]?.main)}
                  size={64}
                  color="#fff"
                />
                <View style={{ marginLeft: 12 }}>
                  <Text style={[styles.city, styles.textShadow]}>{cityLabel || '—'}</Text>
                  <Text style={[styles.desc, styles.textShadow]}>
                    {current.weather?.[0]?.description || '—'}
                  </Text>
                </View>
              </View>

              <Text style={[styles.temp, styles.textShadow]}>
                {displayTemp(current.main?.temp)}{unitSymbol}
              </Text>

              {forecast.length > 0 && (
                <Text style={[styles.minMax, styles.textShadow]}>
                  Máx: {displayTemp(forecast[0].temp_max)}° / Mín: {displayTemp(forecast[0].temp_min)}°
                </Text>
              )}

              <View style={styles.details}>
                <Text style={styles.detailText}>🌡️ Sensación: {displayTemp(current.main?.feels_like ?? 0)}{unitSymbol}</Text>
                <Text style={styles.detailText}>💧 Humedad: {current.main?.humidity}%</Text>
                <Text style={styles.detailText}>🎐 Viento: {displaySpeed(current.wind?.speed)} {speedLabel}</Text>
                <Text style={styles.detailText}>📊 Presión: {current.main?.pressure} hPa</Text>
                {typeof current.visibility === 'number' && (
                  <Text style={styles.detailText}>👁️ Visibilidad: {(current.visibility / 1000).toFixed(1)} km</Text>
                )}
              </View>
            </View>
          </ImageBackground>
        )}

        {/* Gráfico de pronóstico por hora */}
        {hourlyForecast && (
          <View style={[styles.card, dynamicStyles.card, { padding: 16 }]}>
            <Text style={[styles.sectionTitle, dynamicStyles.text]}>Temperatura próximas 24h</Text>
            <LineChart
              data={{...hourlyForecast, datasets: [{ data: hourlyForecast.datasets[0].data.map(displayTemp) }]}}
              width={width - 64} // Ancho de pantalla - padding
              height={220}
              yAxisSuffix={unitSymbol}
              yAxisInterval={1}
              chartConfig={{
                backgroundColor: '#ffffff',
                backgroundGradientFrom: '#ffffff',
                backgroundGradientTo: isDark ? '#1E1E1E' : '#ffffff',
                decimalPlaces: 0,
                color: (opacity = 1) => `rgba(0, 122, 255, ${opacity})`,
                labelColor: (opacity = 1) => isDark ? `rgba(224, 224, 224, ${opacity})` : `rgba(0, 0, 0, ${opacity})`,
                style: {
                  borderRadius: 16,
                },
                propsForDots: {
                  r: '4',
                  strokeWidth: '2',
                  stroke: '#007AFF',
                },
              }}
              bezier
              style={styles.chart}
            />
            <View style={styles.chartIconRow}>
              {hourlyForecast.icons.map((icon, index) => (
                <View key={index} style={styles.chartIconContainer}>
                  <Ionicons name={icon} size={20} color={dynamicStyles.text.color} />
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Pronóstico compacto */}
        {forecast?.length > 0 && (
          <View style={[styles.card, dynamicStyles.card, { padding: 16 }]}>
            <Text style={[styles.sectionTitle, dynamicStyles.text]}>Pronóstico</Text>
            {forecast.map((f) => {
              const dt = new Date((f.dt ?? 0) * 1000);
              return (
                <View key={f.dt} style={styles.forecastRow}>
                  <View style={styles.rowCenter}>
                  <Ionicons name={getWeatherIcon(f.main)} size={24} color={dynamicStyles.text.color} style={{ marginRight: 8 }} />
                  <Text style={[styles.forecastDay, dynamicStyles.text]} numberOfLines={1}>
                    {dt.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' })}
                  </Text>
                  </View>
                <View style={styles.forecastTempsContainer}>
                  <Text style={[styles.forecastDesc, { color: isDark ? '#aaa' : '#555' }]} numberOfLines={1}>
                    {f.desc}
                  </Text>
                  <Text style={[styles.forecastTemp, dynamicStyles.text]}>
                    <Text style={{ fontWeight: 'bold' }}>{displayTemp(f.temp_max ?? 0)}°</Text>
                    {' '} / {' '}
                    <Text style={{ color: isDark ? '#aaa' : '#555' }}>{displayTemp(f.temp_min ?? 0)}°</Text>
                  </Text>
                </View>
                </View>
              );
            })}
          </View>
        )}
      </Animated.View>

      {/* Modal de Información */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={infoModalVisible}
        onRequestClose={() => setInfoModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={[styles.modalContent, dynamicStyles.card]}>
            <Text style={[styles.modalTitle, dynamicStyles.text]}>🌤️ App del Clima</Text>
            <Text style={[styles.modalDescription, dynamicStyles.text]}>
              App desarrollada con React Native y Expo muestra el clima
              actual por geolocalización o búsqueda por ciudad, pronostico 5 dias fondo dinamico cambia con el clima.
            </Text>

            <Text style={[styles.modalSectionTitle, dynamicStyles.text]}>Tecnologías</Text>
            <Text style={[styles.modalTech, dynamicStyles.text]}>React Native, Expo, Expo Router, OpenWeather API, Lottie Animations,eact-native-chart-kit</Text>
            <Text style={[styles.modalTech, dynamicStyles.text]}>Desarrollado Cristofer Claure, Samiel Rojas</Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => setInfoModalVisible(false)}
            >
              <Text style={styles.primaryBtnText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <View style={{ height: Platform.select({ ios: 24, android: 16 }) }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flexOne: { flex: 1 },
  container: { padding: 16 },
  centerContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  muted: { marginTop: 8, color: '#666', fontSize: 16 },
  errorText: { marginTop: 8, color: 'tomato', textAlign: 'center' },
  
  controlsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d8dbe3',
  },
  inputDark: {
    backgroundColor: '#2c2c2e',
    color: '#fff',
    borderColor: '#444',
  },
  iconBtn: {
    height: 44,
    width: 44,
    backgroundColor: '#fff',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d8dbe3',
  },
  switchesContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 8,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: '500',
  },

  card: {
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    overflow: 'hidden', // para que la imagen respete el borde redondeado
  },
  cardImage: {
    borderRadius: 12,
  },
  cardOverlay: {
    backgroundColor: 'rgba(0,0,0,0.3)', // capa oscura para mejorar legibilidad
    padding: 16,
  },
  textShadow: {
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 10,
  },

  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  city: { fontSize: 22, fontWeight: '600', color: '#fff' },
  desc: { color: '#fff', textTransform: 'capitalize' },
  temp: { fontSize: 56, fontWeight: '700', marginTop: 8, alignSelf: 'center', color: '#fff' },
  minMax: { fontSize: 16, alignSelf: 'center', color: '#fff', marginTop: 4 },

  details: {
    marginTop: 16,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    gap: 4,
  },
  detailText: { color: '#fff', fontWeight: '500' },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  chart: {
    marginVertical: 8,
    borderRadius: 16,
  },
  chartIconRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 10, // Ajuste para alinear con las etiquetas del gráfico
    marginTop: 4,
  },
  chartIconContainer: {
    flex: 1,
    alignItems: 'center',
  },

  forecastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e8eaf2',
    gap: 8,
  },
  forecastDay: {
    flexShrink: 1, // Permite que el texto se encoja si no hay espacio
  },
  forecastTempsContainer: {
    marginLeft: 'auto', // Empuja este contenedor hacia la derecha
    alignItems: 'flex-end', // Alinea el texto a la derecha
  },
  forecastDesc: {
    textTransform: 'capitalize',
  },
  forecastTemp: {
    fontWeight: '600',
  },

  primaryBtn: {
    marginTop: 12,
    backgroundColor: '#007AFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  primaryBtnText: { color: '#fff', fontWeight: '600' },

  // Estilos del Modal
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    width: '90%',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  modalDescription: { fontSize: 16, lineHeight: 24, marginBottom: 16, textAlign: 'center' },
  modalSectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  modalTech: {
    fontSize: 16,
    fontStyle: 'italic',
    marginBottom: 24,
  },
});
