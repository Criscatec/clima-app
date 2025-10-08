import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

export default function InfoScreen() {
  return (
    <ScrollView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>🌤️ App del Clima</Text>
        <Text style={styles.description}>
          App desarrollada con React Native y Expo que muestra el clima
          actual por geolocalización o búsqueda por ciudad. Incluye
          actualización con pull-to-refresh, cambio de unidades y
          pronóstico compacto.
        </Text>

        <Text style={styles.sectionTitle}>Tecnologías</Text>
        <Text style={styles.tech}>React Native, Expo, Expo Router, OpenWeather API</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fb' },
  card: {
    backgroundColor: 'white',
    margin: 20,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 12 },
  description: { fontSize: 16, lineHeight: 24, marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  tech: { fontSize: 16, fontStyle: 'italic' },
});
