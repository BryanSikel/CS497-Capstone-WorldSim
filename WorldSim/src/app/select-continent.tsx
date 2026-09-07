import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from "react-native";
import { useRouter } from "expo-router";
import { CONTINENT_CONFIGS, DIFFICULTY_COLORS } from "../data/continentDifficulty";

export default function SelectContinentScreen() {
  const router = useRouter();
  const continents = Object.values(CONTINENT_CONFIGS);

  const handleSelect = (continentName: string) => {
    router.push({
      pathname: "/",
      params: { continent: continentName },
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pick a Continent</Text>
      <FlatList
        data={continents}
        keyExtractor={(item) => item.name}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => handleSelect(item.name)}
          >
            <Text style={styles.cardTitle}>{item.name}</Text>
            <View
              style={[
                styles.badge,
                { backgroundColor: DIFFICULTY_COLORS[item.difficulty] },
              ]}
            >
              <Text style={styles.badgeText}>{item.difficulty}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#101418",
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  title: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 24,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1c2229",
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  cardTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  badge: {
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  badgeText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
});